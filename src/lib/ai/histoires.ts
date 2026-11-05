import "server-only";
import * as z from "zod/v4";
import { cacheGet, cacheSet } from "../db";
import { decouper, type Partie } from "../decoupe";
import { fmtTime } from "../parse";
import { debutDePhrase, enLignes, finDePhrase, sousTitres, type Phrase } from "../sous-titres";
import type { Video } from "../types";
import { GeminiSurcharge, geminiWatchYouTube, hasGemini, jsonIn } from "./models";
import { DUREE_MAX_VIDEO } from "./extraits";
import { lireAvecFormat, QUESTION_FORMAT } from "../format";
import LIMITES from "@/config/limites.json";

// Histoires en parties : toute la vidéo, du premier moment intéressant jusqu'à la fin, découpée en parties qui se
// suivent (Partie 1, 2, 3…) à poster l'une après l'autre. La personne choisit la durée (1, 2 ou 3 min) avant ; Gemini
// regarde toute la vidéo, avec ses sous-titres, et décide lui-même chaque coupure : la durée varie (59 s, puis 48 s,
// puis 1 min 05…) pour couper là où le spectateur reste frustré de ne pas avoir la suite. Chaque partie reprend les
// 2 ou 3 dernières secondes de la précédente. Une découpe par durée, gardée 7 jours pour tout le monde.

const Serie = z.object({
  debut: z.number(), fin: z.number(),
  titre: z.string(), resume: z.string(),
  parties: z.array(z.object({ start: z.number(), end: z.number() })),
});

export type Histoire = { start: number; end: number; titre: string; resume: string; suspense: number[]; parties?: Partie[] };
export type HistoiresResult = { histoires: Histoire[]; avertissement: string | null; creeLe: number; duree?: number };

const H = LIMITES.histoires;
/** Clé du cache : une découpe par vidéo et par durée de partie. */
export const cleHistoires = (videoId: string, duree: number) => `serie:${videoId}:${duree}`;
/** Les durées de partie possibles pour une vidéo : il faut de quoi faire au moins `partiesMin` parties. */
export const dureesPour = (dureeVideo: number) => H.durees.filter((d) => dureeVideo >= d * H.partiesMin);

const prompt = (v: Video, duree: number, phrases: Phrase[]) => {
  const min = Math.round(duree * 0.75), max = Math.min(H.partieMax, Math.round(duree * 1.25));
  return `Regarde cette vidéo YouTube en entier (« ${v.title} », ${fmtTime(v.duration)}).
On va la poster sur TikTok en parties qui se suivent (« Partie 1 », « Partie 2 »…), d'environ ${fmtTime(duree)} chacune, du premier moment intéressant jusqu'à la fin.

1. "debut" : la seconde où la vidéo devient intéressante, après le générique, l'intro, les annonces ou la pub (0 si elle commence tout de suite). "fin" : la seconde où le contenu se termine, avant la conclusion, les remerciements et l'écran de fin.
2. "parties" : découpe tout, de "debut" à "fin", en parties qui se suivent. Chaque partie dure entre ${min} et ${max} secondes : la durée change d'une partie à l'autre pour couper au bon moment. Chaque partie (sauf la dernière) se termine sur un moment qui frustre le spectateur et lui donne envie de voir la suite : juste avant une révélation, une réponse, une chute, ou sur une question laissée en suspens. Jamais au milieu d'une phrase.
3. Chaque partie après la première commence ${H.recul - 1} à ${H.recul} secondes avant la fin de la précédente, au début d'une phrase, pour que le spectateur retrouve le fil.
4. "titre" : le titre de la série, 6 mots maximum, en français. "resume" : de quoi parle la vidéo, une phrase, en français.
Règles : les minutages doivent correspondre à ce qu'on voit et entend réellement. N'invente rien.
${phrases.length ? `\nSous-titres de la vidéo, avec leurs minutages, pour couper pile en fin de phrase :\n${enLignes(phrases)}\n` : ""}
Dis aussi si la vidéo supporte d'être recadrée en vertical.
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{${QUESTION_FORMAT},
"serie": {"debut": secondes, "fin": secondes, "titre": "…", "resume": "…", "parties": [{"start": secondes, "end": secondes}, …]}}`;
};

export async function findHistoires(v: Video, duree: number): Promise<HistoiresResult> {
  if (v.duration > DUREE_MAX_VIDEO) throw new Error(`Vidéo trop longue (plus de ${DUREE_MAX_VIDEO / 3600} h).`);
  const key = cleHistoires(v.id, duree);
  const deja = cacheGet<HistoiresResult>(key);
  if (deja) return deja;
  const r = await compute(v, duree);
  // Sans l'IA, la découpe régulière n'est gardée qu'une heure : on pourra réessayer et avoir des coupures choisies.
  cacheSet(key, r.value, r.ok ? LIMITES.cache.extraitsHeures : 1);
  return r.value;
}

async function compute(v: Video, duree: number): Promise<{ ok: boolean; value: HistoiresResult }> {
  const creeLe = Date.now();
  // Toujours une histoire : la vidéo entière, coupée à intervalles réguliers, si l'IA ne peut pas aider.
  const reguliere = (avertissement: string) => ({ ok: false, value: { creeLe, duree, avertissement, histoires: [{
    start: 0, end: v.duration, titre: v.title.slice(0, 60), resume: "", suspense: [], parties: decouper(0, v.duration, [], duree, H.partieMax, H.recul),
  }] } });
  if (!hasGemini()) return reguliere("Clé Gemini manquante : parties coupées à intervalles réguliers.");
  const phrases = await sousTitres(v);
  let s: z.infer<typeof Serie>;
  try {
    const raw = jsonIn(await geminiWatchYouTube(v.id, v.duration, prompt(v, duree, phrases), v.id));
    lireAvecFormat(v.id, raw, "serie");
    s = Serie.parse((raw as { serie?: unknown }).serie);
  } catch (e) {
    if (e instanceof GeminiSurcharge) throw e;
    console.warn("[histoires] Gemini :", (e as Error).message);
    return reguliere("L'IA n'a pas pu regarder la vidéo : les parties sont coupées à intervalles réguliers.");
  }
  const parties = verifier(s.parties, v.duration, duree, phrases);
  if (parties.length < 2) return reguliere("L'IA n'a pas donné de découpe exploitable : les parties sont coupées à intervalles réguliers.");
  const debut = parties[0].start, fin = parties.at(-1)!.end;
  console.info(`[histoires] ${v.id} (${duree} s) : ${parties.length} parties de ${debut} s à ${fin} s, ${phrases.length ? "avec" : "sans"} sous-titres`);
  return { ok: true, value: { creeLe, duree, avertissement: null, histoires: [{ start: debut, end: fin, titre: s.titre, resume: s.resume, suspense: parties.map((p) => p.end), parties }] } };
}

/** Contrôles sans IA : parties dans la vidéo et dans l'ordre, fins calées sur les fins de phrase, chaque partie qui
 *  reprend 2 à 3 s de la précédente, une partie bien trop longue recoupée sur une fin de phrase, et pas de dernière
 *  partie minuscule. */
export function verifier(brutes: { start: number; end: number }[], dureeVideo: number, duree: number, phrases: Phrase[]): Partie[] {
  const tri = brutes
    .map((p) => ({ start: Math.max(0, p.start), end: Math.min(dureeVideo, p.end) }))
    .filter((p) => p.end - p.start >= 10)
    .sort((a, b) => a.start - b.start);
  const out: Partie[] = [];
  for (const p of tri) {
    const prev = out.at(-1);
    let start = Math.round(p.start);
    if (prev) {
      // Reprise de 2 à 3 s : sinon on la fixe à `recul` secondes avant la fin de la précédente.
      if (start < prev.end - H.recul - 1 || start > prev.end - 2) start = prev.end - H.recul;
      start = Math.min(prev.end - 2, Math.max(prev.end - H.recul, debutDePhrase(phrases, start)));
    }
    const end = finDePhrase(phrases, p.end);
    if (end - start < 10 || end - start > H.partieMax + H.recul) continue;
    if (prev && end <= prev.end) continue;
    out.push({ n: out.length + 1, start, end });
  }
  // Une partie bien plus longue que la durée choisie (l'IA déborde parfois) est recoupée sur des fins de phrase.
  const finsDePhrase = phrases.map((p) => p.end);
  const coupees = out.flatMap((p) => (p.end - p.start > duree * 1.4 + 10
    ? decouper(p.start, p.end, finsDePhrase.filter((t) => t > p.start && t < p.end), duree, H.partieMax, H.recul) : [p]));
  // Une dernière partie minuscule rejoint la précédente, si l'ensemble reste raisonnable.
  const der = coupees.at(-1), avant = coupees.at(-2);
  if (der && avant && der.end - der.start < Math.max(25, duree * 0.4) && der.end - avant.start <= Math.min(H.partieMax, duree * 1.6)) {
    coupees.splice(-2, 2, { ...avant, end: der.end });
  }
  return coupees.map((p, i) => ({ ...p, n: i + 1 }));
}
