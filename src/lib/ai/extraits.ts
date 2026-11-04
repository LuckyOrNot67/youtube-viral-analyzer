import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { cached } from "../db";
import { fmtTime } from "../parse";
import type { Extrait, Video } from "../types";
import { commentsOf } from "./comments";
import { citationsIn, citedMoments, type Moment } from "./moments";
import { claude, CLAUDE_MODEL, geminiWatchYouTube, hasClaude, hasGemini, jsonIn } from "./models";
import LIMITES from "@/config/limites.json";

// Meilleurs passages d'une vidéo longue : 1) moments cités en commentaires, 2) Gemini regarde la vidéo par son
// lien et propose des candidats minutés, 3) Claude note chaque candidat pour un Short, 4) contrôles sans IA.

export const DUREE_MAX_VIDEO = 3 * 3600;
/** Un grand choix pour que chaque groupe de personnes reçoive des passages différents : environ un toutes les 2 min. */
export const nbPassages = (duree: number) => Math.max(8, Math.min(LIMITES.analyse.passagesMax, Math.round(duree / 120)));

const Candidate = z.object({
  start: z.number(), end: z.number(),
  type: z.string(), premiere_phrase: z.string(), resume: z.string(),
});
type Candidate = z.infer<typeof Candidate>;

const watchPrompt = (v: Video, moments: Moment[]) => `Regarde cette vidéo YouTube en entier (« ${v.title} », ${fmtTime(v.duration)}).
Trouve ${nbPassages(v.duration)} passages différents, qui ne se chevauchent pas, pour en faire des vidéos courtes verticales (Shorts, Reels, TikTok).
Il en faut ${nbPassages(v.duration)}, répartis sur toute la vidéo : les plus forts d'abord, puis les bons passages qui restent (ils seront notés ensuite).

Un bon passage :
- se comprend sans avoir vu le reste de la vidéo ;
- commence fort (pas au milieu d'une phrase) et se termine sur une chute ou une conclusion claire ;
- dure entre 20 et 60 secondes (90 au maximum) ;
- contient une révélation, une réaction forte, une histoire courte, une info surprenante, une réponse claire, un débat, un moment drôle, une démonstration, une transformation, un conseil concret ou une phrase marquante.
${moments.length ? `\nDes spectateurs citent ces moments dans les commentaires (à vérifier dans la vidéo) : ${moments.map((m) => fmtTime(m.t)).join(", ")}.\n` : ""}
Règles : les minutages doivent correspondre à ce qu'on voit et entend réellement dans la vidéo. N'invente rien.
Réponds UNIQUEMENT avec un tableau JSON, sans texte autour :
[{"start": secondes depuis le début (nombre), "end": secondes (nombre), "type": "révélation|réaction|histoire|info|réponse|débat|drôle|démo|transformation|conseil|phrase", "premiere_phrase": "la première phrase prononcée dans le passage, mot pour mot", "resume": "ce qui se passe, en une phrase"}]`;

const Notes = z.object({
  notes: z.array(z.object({
    index: z.number().int(),
    scoreShorts: z.number().describe("0 à 10 : force du début, compréhension seule, densité, émotion, chute claire, durée, adapté au vertical"),
    titre: z.string().describe("Titre court du Short, 6 mots maximum"),
    hook: z.string().describe("Phrase d'accroche à écrire ou dire dans les 2 premières secondes, 10 mots maximum, sans promettre de vues"),
    justification: z.string().describe("Pourquoi ce passage marche en format court, une phrase, en s'appuyant sur le résumé"),
  })),
});

/** `extraits` : tous les passages trouvés (le choix complet, partagé entre les lots). `creeLe` : date de l'analyse. */
export type ExtraitsResult = { extraits: Extrait[]; moments: Moment[]; source: "gemini" | "commentaires"; avertissement: string | null; creeLe: number };
/** Étapes réelles du calcul, affichées pendant l'attente. */
export type Etape = "commentaires" | "video" | "notes";

export async function findExtraits(v: Video, onEtape: (e: Etape) => void = () => {}): Promise<ExtraitsResult> {
  if (v.duration > DUREE_MAX_VIDEO) throw new Error(`Vidéo trop longue (plus de ${DUREE_MAX_VIDEO / 3600} h).`);
  const { value } = await cached(`extraits:${v.id}`, LIMITES.cache.extraitsHeures, () => compute(v, onEtape));
  return { ...value, creeLe: value.creeLe ?? 0 }; // analyses gardées avant l'ajout de la date
}

async function compute(v: Video, onEtape: (e: Etape) => void): Promise<ExtraitsResult> {
  const creeLe = Date.now();
  onEtape("commentaires");
  const moments = citedMoments(await commentsOf(v.id).catch(() => []), v.duration);
  if (!hasGemini()) return { creeLe, extraits: [], moments, source: "commentaires", avertissement: "Clé Gemini manquante : seuls les moments cités en commentaires sont disponibles." };

  let candidates: Candidate[];
  onEtape("video");
  try {
    const raw = jsonIn(await geminiWatchYouTube(v.id, v.duration, watchPrompt(v, moments), v.id));
    candidates = z.array(Candidate).parse(raw);
  } catch (e) {
    console.warn("[extraits] Gemini :", (e as Error).message);
    return { creeLe, extraits: [], moments, source: "commentaires", avertissement: "La vidéo n'a pas pu être regardée par l'IA (vidéo privée, réservée aux adultes ou trop récente). Voici les moments cités par les spectateurs." };
  }

  // Contrôles sans IA : minutages dans la vidéo, durée raisonnable, pas de doublon.
  const { dureeMin, dureeMax } = LIMITES.short;
  const ok = candidates
    .map((c) => ({ ...c, start: Math.max(0, Math.round(c.start)), end: Math.min(v.duration, Math.round(c.end)) }))
    .filter((c) => c.end - c.start >= dureeMin && c.end - c.start <= dureeMax)
    .filter((c, i, all) => !all.slice(0, i).some((o) => Math.min(o.end, c.end) - Math.max(o.start, c.start) > (c.end - c.start) / 2));
  console.info(`[extraits] ${v.id} : ${candidates.length} passages proposés par l'IA, ${ok.length} gardés`);
  if (!ok.length) return { creeLe, extraits: [], moments, source: "commentaires", avertissement: "L'IA n'a pas trouvé de passage exploitable avec des minutages fiables." };

  let notes: z.infer<typeof Notes>["notes"] = [];
  if (hasClaude()) {
    onEtape("notes");
    const res = await claude(v.id).messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 10000,
      system: "Tu notes des passages de vidéos YouTube pour en faire des Shorts. Tu écris en français. Tu t'appuies uniquement sur les descriptions fournies, tu ne promets jamais de vues.",
      messages: [{ role: "user", content: `Vidéo : « ${v.title} » (${v.channelTitle}).\n\nPassages candidats :\n${ok.map((c, i) =>
        `${i}. ${fmtTime(c.start)} → ${fmtTime(c.end)} (${c.end - c.start} s), ${c.type}. Début : « ${c.premiere_phrase} ». ${c.resume}${citationsIn(moments, c.start, c.end) ? ` Cité ${citationsIn(moments, c.start, c.end)} fois dans les commentaires.` : ""}`).join("\n")}\n\nNote chaque passage.` }],
      output_config: { format: zodOutputFormat(Notes) },
    });
    notes = res.parsed_output?.notes ?? [];
  }

  const extraits: Extrait[] = ok.map((c, i) => {
    const n = notes.find((x) => x.index === i);
    const citations = citationsIn(moments, c.start, c.end);
    return {
      start: c.start, end: c.end, type: c.type, resume: c.resume,
      titre: n?.titre ?? c.resume.slice(0, 60), hook: n?.hook ?? c.premiere_phrase, justification: n?.justification ?? "",
      // Un passage que les spectateurs citent eux-mêmes gagne un petit bonus (preuve réelle d'intérêt).
      scoreShorts: Math.round(Math.min(10, (n?.scoreShorts ?? 5) + Math.min(1, citations * 0.25)) * 10) / 10,
      citations,
    };
  }).sort((a, b) => b.scoreShorts - a.scoreShorts);

  return { creeLe, extraits, moments, source: "gemini", avertissement: hasClaude() ? null : "Clé Claude manquante : les passages ne sont pas notés." };
}
