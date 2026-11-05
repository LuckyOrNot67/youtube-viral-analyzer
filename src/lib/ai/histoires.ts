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
// suivent (Partie 1, 2, 3…) à poster l'une après l'autre. Gemini ne coupe rien : il regarde toute la vidéo une seule
// fois, avec ses sous-titres, et note où couper pour chaque durée possible (1, 2 et 3 min) d'un coup. La durée varie
// (59 s, puis 48 s, puis 1 min 05…) pour couper là où le spectateur reste frustré de ne pas avoir la suite ; chaque
// partie reprend 2 ou 3 s de la précédente. C'est notre serveur qui coupe ensuite. Changer de durée est donc immédiat
// et gratuit. Gardé 7 jours pour tout le monde.

const Coupe = z.array(z.object({ start: z.number(), end: z.number() }));
const Serie = z.object({
  debut: z.number(), fin: z.number(),
  titre: z.string(), resume: z.string(),
  decoupes: z.record(z.string(), z.unknown()),
});

export type Histoire = {
  start: number; end: number; titre: string; resume: string; suspense: number[];
  /** Les parties pour chaque durée possible (clé : la durée en secondes). */
  decoupes?: Record<string, Partie[]>;
  /** Découpe d'une seule durée (anciennes analyses). */
  parties?: Partie[];
};
export type HistoiresResult = { histoires: Histoire[]; avertissement: string | null; creeLe: number; durees?: number[] };

const H = LIMITES.histoires;
export const cleHistoires = (videoId: string) => `series:${videoId}`;
/** Les durées de partie possibles pour une vidéo : il faut de quoi faire au moins `partiesMin` parties. */
export const dureesPour = (dureeVideo: number) => H.durees.filter((d) => dureeVideo >= d * H.partiesMin);

const prompt = (v: Video, durees: number[], phrases: Phrase[]) => `Regarde cette vidéo YouTube en entier (« ${v.title} », ${fmtTime(v.duration)}).
On va la poster sur TikTok en parties qui se suivent (« Partie 1 », « Partie 2 »…), du premier moment intéressant jusqu'à la fin. Tu ne coupes rien toi-même : tu notes seulement où couper. Le créateur choisira la durée des parties, alors donne une découpe complète pour chacune de ces durées : ${durees.map((d) => `${d} s`).join(", ")}.

1. "debut" : la seconde où la vidéo devient intéressante, après le générique, l'intro, les annonces ou la pub (0 si elle commence tout de suite). "fin" : la seconde où le contenu se termine, avant la conclusion, les remerciements et l'écran de fin. Les découpes vont toutes de "debut" à "fin".
2. "decoupes" : pour chaque durée, la liste complète des parties qui se suivent. ${durees.map((d) => `Pour ${d} s, chaque partie dure entre ${Math.round(d * 0.75)} et ${Math.min(H.partieMax, Math.round(d * 1.25))} secondes`).join(" ; ")}. La durée change d'une partie à l'autre pour couper au bon moment : chaque partie (sauf la dernière) se termine sur un moment qui frustre le spectateur et lui donne envie de voir la suite, juste avant une révélation, une réponse, une chute, ou sur une question laissée en suspens. Jamais au milieu d'une phrase. Respecte ces durées : une partie trop longue sera recoupée au hasard.
3. Chaque partie après la première commence ${H.recul - 1} à ${H.recul} secondes avant la fin de la précédente, au début d'une phrase, pour que le spectateur retrouve le fil.
4. "titre" : le titre de la série, 6 mots maximum, en français. "resume" : de quoi parle la vidéo, une phrase, en français.
Règles : les minutages doivent correspondre à ce qu'on voit et entend réellement. N'invente rien.
${phrases.length ? `\nSous-titres de la vidéo, avec leurs minutages, pour couper pile en fin de phrase :\n${enLignes(phrases)}\n` : ""}
Dis aussi si la vidéo supporte d'être recadrée en vertical.
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{${QUESTION_FORMAT},
"serie": {"debut": secondes, "fin": secondes, "titre": "…", "resume": "…", "decoupes": {${durees.map((d) => `"${d}": [{"start": secondes, "end": secondes}, …]`).join(", ")}}}}`;

export async function findHistoires(v: Video): Promise<HistoiresResult> {
  if (v.duration > DUREE_MAX_VIDEO) throw new Error(`Vidéo trop longue (plus de ${DUREE_MAX_VIDEO / 3600} h).`);
  const key = cleHistoires(v.id);
  const deja = cacheGet<HistoiresResult>(key);
  if (deja) return deja;
  const r = await compute(v);
  // Sans l'IA, la découpe régulière n'est gardée qu'une heure : on pourra réessayer et avoir des coupures choisies.
  cacheSet(key, r.value, r.ok ? LIMITES.cache.extraitsHeures : 1);
  return r.value;
}

async function compute(v: Video): Promise<{ ok: boolean; value: HistoiresResult }> {
  const creeLe = Date.now();
  const durees = dureesPour(v.duration);
  // Toujours une histoire : la vidéo entière, coupée à intervalles réguliers, si l'IA ne peut pas aider.
  const reguliere = (avertissement: string) => ({ ok: false, value: { creeLe, durees, avertissement, histoires: [{
    start: 0, end: v.duration, titre: v.title.slice(0, 60), resume: "", suspense: [],
    decoupes: Object.fromEntries(durees.map((d) => [String(d), decouper(0, v.duration, [], d, H.partieMax, H.recul)])),
  }] } });
  if (!hasGemini()) return reguliere("Clé Gemini manquante : parties coupées à intervalles réguliers.");
  const phrases = await sousTitres(v);
  let s: z.infer<typeof Serie>;
  try {
    const raw = jsonIn(await geminiWatchYouTube(v.id, v.duration, prompt(v, durees, phrases), v.id));
    lireAvecFormat(v.id, raw, "serie");
    s = Serie.parse((raw as { serie?: unknown }).serie);
  } catch (e) {
    if (e instanceof GeminiSurcharge) throw e;
    console.warn("[histoires] Gemini :", (e as Error).message);
    return reguliere("L'IA n'a pas pu regarder la vidéo : les parties sont coupées à intervalles réguliers.");
  }
  const debut = Math.max(0, Math.round(s.debut)), fin = Math.min(v.duration, Math.round(s.fin) || v.duration);
  // Une durée que l'IA a mal découpée est recoupée chez nous, sur les coupures qu'elle a notées pour les autres
  // durées et les fins de phrase.
  const notees = Object.values(s.decoupes).flatMap((x) => { const r = Coupe.safeParse(x); return r.success ? r.data.map((p) => p.end) : []; });
  const decoupes: Record<string, Partie[]> = {};
  for (const d of durees) {
    const r = Coupe.safeParse(s.decoupes[String(d)]);
    let parties = r.success ? verifier(r.data, v.duration, d, phrases) : [];
    if (parties.length < 2) {
      parties = decouper(debut, fin > debut + 60 ? fin : v.duration, [...notees, ...phrases.map((p) => p.end)], d, H.partieMax, H.recul);
      console.warn(`[histoires] ${v.id} : découpe de ${d} s refaite chez nous`);
    }
    decoupes[String(d)] = parties;
  }
  const toutes = Object.values(decoupes);
  const start = Math.min(...toutes.map((p) => p[0].start)), end = Math.max(...toutes.map((p) => p.at(-1)!.end));
  console.info(`[histoires] ${v.id} : ${durees.map((d) => `${decoupes[String(d)].length} parties de ${d} s`).join(", ")}, ${phrases.length ? "avec" : "sans"} sous-titres`);
  return { ok: true, value: { creeLe, durees, avertissement: null, histoires: [{ start, end, titre: s.titre, resume: s.resume, suspense: notees, decoupes }] } };
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
