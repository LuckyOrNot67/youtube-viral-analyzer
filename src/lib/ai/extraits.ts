import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { cached } from "../db";
import { fmtTime } from "../parse";
import type { Extrait, Video } from "../types";
import { commentsOf } from "./comments";
import { citationsIn, citedMoments, type Moment } from "./moments";
import { bienFormes, claude, CLAUDE_MODEL, GeminiSurcharge, geminiWatchYouTube, hasClaude, hasGemini, jsonIn } from "./models";
import { lireAvecFormat, QUESTION_FORMAT } from "../format";
import LIMITES from "@/config/limites.json";
import STYLE from "@/config/style-tiktok.json";

// Meilleurs passages d'une vidéo longue : 1) moments cités en commentaires, 2) Gemini regarde la vidéo par son
// lien et propose des candidats minutés, 3) Claude (Haiku) lit leurs résumés et écrit la note, le titre, la légende et
// les hashtags de chaque Short, 4) contrôles sans IA.

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
Dis aussi si la vidéo supporte d'être recadrée en vertical.
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{${QUESTION_FORMAT},
"passages": [{"start": secondes depuis le début (nombre), "end": secondes (nombre), "type": "révélation|réaction|histoire|info|réponse|débat|drôle|démo|transformation|conseil|phrase", "premiere_phrase": "la première phrase prononcée dans le passage, mot pour mot", "resume": "ce qui se passe, en une phrase"}]}`;

/** Le style TikTok appris par Haiku : règles et exemples de src/config/style-tiktok.json (à nourrir de vrais posts). */
const STYLE_TIKTOK = `Écris comme sur TikTok, pas comme sur YouTube.
${STYLE.regles.map((r) => `- ${r}`).join("\n")}

Exemples du ton attendu (inspire-toi du ton, ne recopie jamais leurs phrases) :
${STYLE.exemples.map((e) => `- ${e.sujet} → titre « ${e.titre} », légende « ${e.legende} », ${e.hashtags.join(" ")}`).join("\n")}`;

const Notes = z.object({
  notes: z.array(z.object({
    index: z.number().int(),
    scoreShorts: z.number().describe("0 à 10 : force du début, compréhension seule, densité, émotion, chute claire, durée, adapté au vertical"),
    titre: z.string().describe("Texte de couverture façon TikTok, 2 à 6 mots"),
    description: z.string().describe("Légende TikTok : une phrase courte, 100 caractères au plus, sans hashtag"),
    hashtags: z.array(z.string()).describe("3 à 5 hashtags TikTok en minuscules, avec le #, #pourtoi en dernier"),
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
    const raw = lireAvecFormat(v.id, jsonIn(await geminiWatchYouTube(v.id, v.duration, watchPrompt(v, moments), v.id)), "passages");
    // Un passage mal écrit par Gemini (sans minutage…) est ignoré, sans jeter les autres.
    candidates = bienFormes(raw, Candidate);
  } catch (e) {
    // Saturé : rien n'est gardé, on réessaiera (voir relance.ts).
    if (e instanceof GeminiSurcharge) throw e;
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
      system: `Tu prépares des Shorts TikTok à partir de passages de vidéos YouTube. Pour chacun : une note, un titre de couverture, une légende et des hashtags. Tu écris en français. Tu t'appuies uniquement sur ce qui est fourni, tu ne promets jamais de vues.\n\n${STYLE_TIKTOK}`,
      messages: [{ role: "user", content: `Vidéo : « ${v.title} » (${v.channelTitle}).${v.tags?.length ? `\nMots-clés YouTube : ${v.tags.join(", ")}.` : ""}${v.description ? `\nDescription YouTube (début) : ${v.description.replace(/\s+/g, " ").slice(0, 400)}` : ""}\n\nPassages candidats :\n${ok.map((c, i) =>
        `${i}. ${fmtTime(c.start)} → ${fmtTime(c.end)} (${c.end - c.start} s), ${c.type}. Début : « ${c.premiere_phrase} ». ${c.resume}${citationsIn(moments, c.start, c.end) ? ` Cité ${citationsIn(moments, c.start, c.end)} fois dans les commentaires.` : ""}`).join("\n")}\n\nPrépare chaque passage.` }],
      output_config: { format: zodOutputFormat(Notes) },
    });
    notes = res.parsed_output?.notes ?? [];
  }

  const extraits: Extrait[] = ok.map((c, i) => {
    const n = notes.find((x) => x.index === i);
    const citations = citationsIn(moments, c.start, c.end);
    return {
      start: c.start, end: c.end, type: c.type, resume: c.resume,
      titre: n?.titre ?? c.premiere_phrase, description: n?.description ?? c.resume, hashtags: (n?.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "")),
      // Un passage que les spectateurs citent eux-mêmes gagne un petit bonus (preuve réelle d'intérêt).
      scoreShorts: Math.round(Math.min(10, (n?.scoreShorts ?? 5) + Math.min(1, citations * 0.25)) * 10) / 10,
      citations,
    };
  }).sort((a, b) => b.scoreShorts - a.scoreShorts);

  return { creeLe, extraits, moments, source: "gemini", avertissement: hasClaude() ? null : "Clé Claude manquante : les passages ne sont pas notés." };
}
