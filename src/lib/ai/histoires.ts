import "server-only";
import * as z from "zod/v4";
import { cacheGet, cacheSet } from "../db";
import { fmtTime } from "../parse";
import type { Video } from "../types";
import { bienFormes, GeminiSurcharge, geminiWatchYouTube, hasGemini, jsonIn } from "./models";
import { DUREE_MAX_VIDEO } from "./extraits";
import { lireAvecFormat, QUESTION_FORMAT } from "../format";
import LIMITES from "@/config/limites.json";

// Histoires en parties : Gemini regarde la vidéo par son lien, repère les histoires complètes (un récit, une anecdote,
// un thread, une enquête…) et les moments où couper laisse le spectateur sur sa faim. Rien n'est inventé : une vidéo
// sans histoire n'en donne pas.

const Brute = z.object({
  start: z.number(), end: z.number(),
  titre: z.string(), resume: z.string(),
  suspense: z.array(z.number()),
});

export type Histoire = { start: number; end: number; titre: string; resume: string; suspense: number[] };
export type HistoiresResult = { histoires: Histoire[]; avertissement: string | null; creeLe: number };

const prompt = (v: Video) => `Regarde cette vidéo YouTube en entier (« ${v.title} », ${fmtTime(v.duration)}).
Trouve les histoires complètes qu'on peut poster en plusieurs parties sur TikTok (« Partie 1 », « Partie 2 »…) : un récit, une anecdote racontée, un thread, une enquête, une aventure, un drame, une histoire d'horreur.

Une bonne histoire :
- a un début qui pose la situation et une fin qui conclut (pas coupée au milieu) ;
- dure au moins ${Math.round(LIMITES.histoires.dureeMin / 60)} minutes ;
- donne envie de connaître la suite.
Si toute la vidéo est une seule histoire, donne-la en entier. S'il n'y a aucune histoire, donne une liste vide.

Pour chaque histoire, donne les moments de suspense où couper : la fin d'une phrase juste avant une révélation, une question laissée en l'air, un rebondissement. Environ un toutes les 30 à 60 secondes.
Règles : les minutages doivent correspondre à ce qu'on voit et entend réellement. N'invente rien.
Dis aussi si la vidéo supporte d'être recadrée en vertical.
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{${QUESTION_FORMAT},
"histoires": [{"start": secondes (nombre), "end": secondes (nombre), "titre": "titre de l'histoire, 6 mots maximum, en français", "resume": "de quoi parle l'histoire, une phrase, en français", "suspense": [secondes, …]}]}`;

export async function findHistoires(v: Video): Promise<HistoiresResult> {
  if (v.duration > DUREE_MAX_VIDEO) throw new Error(`Vidéo trop longue (plus de ${DUREE_MAX_VIDEO / 3600} h).`);
  const key = `histoires:${v.id}`;
  const deja = cacheGet<HistoiresResult>(key);
  if (deja) return deja;
  const r = await compute(v);
  // Un échec de l'IA n'est pas gardé : on pourra réessayer tout de suite.
  if (r.ok) cacheSet(key, r.value, LIMITES.cache.extraitsHeures);
  return r.value;
}

async function compute(v: Video): Promise<{ ok: boolean; value: HistoiresResult }> {
  const creeLe = Date.now();
  if (!hasGemini()) return { ok: false, value: { creeLe, histoires: [], avertissement: "Clé Gemini manquante : impossible de regarder la vidéo." } };
  let brutes: z.infer<typeof Brute>[];
  try {
    brutes = bienFormes(lireAvecFormat(v.id, jsonIn(await geminiWatchYouTube(v.id, v.duration, prompt(v), v.id)), "histoires"), Brute);
  } catch (e) {
    if (e instanceof GeminiSurcharge) throw e;
    console.warn("[histoires] Gemini :", (e as Error).message);
    return { ok: false, value: { creeLe, histoires: [], avertissement: "La vidéo n'a pas pu être regardée par l'IA (vidéo privée, réservée aux adultes ou trop récente)." } };
  }
  // Contrôles sans IA : dans la vidéo, assez longue, pas de doublon, suspense à l'intérieur de l'histoire.
  const histoires = brutes
    .map((h) => ({ ...h, start: Math.max(0, Math.round(h.start)), end: Math.min(v.duration, Math.round(h.end)) }))
    .filter((h) => h.end - h.start >= LIMITES.histoires.dureeMin)
    .filter((h, i, all) => !all.slice(0, i).some((o) => Math.min(o.end, h.end) - Math.max(o.start, h.start) > (h.end - h.start) / 2))
    .map((h) => ({ ...h, suspense: h.suspense.map(Math.round).filter((t) => t > h.start && t < h.end).sort((a, b) => a - b) }))
    .sort((a, b) => a.start - b.start);
  console.info(`[histoires] ${v.id} : ${brutes.length} histoires proposées par l'IA, ${histoires.length} gardées`);
  return { ok: true, value: { creeLe, histoires, avertissement: histoires.length ? null : "Pas d'histoire complète dans cette vidéo." } };
}
