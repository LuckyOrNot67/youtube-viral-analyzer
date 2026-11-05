import "server-only";
import * as z from "zod/v4";
import { cacheGet, cacheSet } from "../db";
import { fmtTime } from "../parse";
import type { Video } from "../types";
import { GeminiSurcharge, geminiWatchYouTube, hasGemini, jsonIn } from "./models";
import { DUREE_MAX_VIDEO } from "./extraits";
import { lireAvecFormat, QUESTION_FORMAT } from "../format";
import LIMITES from "@/config/limites.json";

// Histoires en parties : toute la vidéo, découpée en parties qui se suivent (Partie 1, 2, 3…) à poster l'une après
// l'autre. Gemini regarde la vidéo par son lien et dit seulement où elle devient intéressante (après le générique,
// l'intro ou la pub), où elle se termine (avant la conclusion et l'écran de fin), et les fins de phrase où couper
// proprement. Sans réponse de l'IA, la vidéo entière est coupée à intervalles réguliers : il y a toujours une histoire.

const Serie = z.object({
  debut: z.number(), fin: z.number(),
  titre: z.string(), resume: z.string(),
  coupures: z.array(z.number()),
});

export type Histoire = { start: number; end: number; titre: string; resume: string; suspense: number[] };
export type HistoiresResult = { histoires: Histoire[]; avertissement: string | null; creeLe: number };

/** Clé du cache (« serie » : la découpe en parties qui se suivent, qui a remplacé les histoires complètes). */
export const cleHistoires = (videoId: string) => `serie:${videoId}`;

const prompt = (v: Video) => `Regarde cette vidéo YouTube en entier (« ${v.title} », ${fmtTime(v.duration)}).
On va la poster sur TikTok en parties qui se suivent (« Partie 1 », « Partie 2 »…), de 1 à 3 minutes chacune, du premier moment intéressant jusqu'à la fin.

Donne :
- "debut" : la seconde où la vidéo devient intéressante, après le générique, l'intro, les annonces ou la pub (0 si elle commence tout de suite) ;
- "fin" : la seconde où le contenu se termine, avant la conclusion, les remerciements et l'écran de fin ;
- "coupures" : les secondes où l'on peut couper proprement entre "debut" et "fin" (fin d'une phrase, petite pause, juste avant une révélation ou une question laissée en l'air). Il en faut beaucoup, une toutes les 20 à 30 secondes sur toute la durée : au moins ${Math.max(6, Math.round(v.duration / 30))} ;
- "titre" : le titre de la série, 6 mots maximum, en français ;
- "resume" : de quoi parle la vidéo, une phrase, en français.
Règles : les minutages doivent correspondre à ce qu'on voit et entend réellement. N'invente rien.
Dis aussi si la vidéo supporte d'être recadrée en vertical.
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{${QUESTION_FORMAT},
"serie": {"debut": secondes, "fin": secondes, "coupures": [secondes, …], "titre": "…", "resume": "…"}}`;

export async function findHistoires(v: Video): Promise<HistoiresResult> {
  if (v.duration > DUREE_MAX_VIDEO) throw new Error(`Vidéo trop longue (plus de ${DUREE_MAX_VIDEO / 3600} h).`);
  const key = cleHistoires(v.id);
  const deja = cacheGet<HistoiresResult>(key);
  if (deja) return deja;
  const r = await compute(v);
  // Sans l'IA, la découpe régulière n'est gardée qu'une heure : on pourra réessayer et avoir des coupures propres.
  cacheSet(key, r.value, r.ok ? LIMITES.cache.extraitsHeures : 1);
  return r.value;
}

async function compute(v: Video): Promise<{ ok: boolean; value: HistoiresResult }> {
  const creeLe = Date.now();
  // Toujours une histoire : la vidéo entière, coupée à intervalles réguliers, si l'IA ne peut pas aider.
  const reguliere = (avertissement: string) => ({ ok: false, value: { creeLe, avertissement, histoires: [{ start: 0, end: v.duration, titre: v.title.slice(0, 60), resume: "", suspense: [] }] } });
  if (!hasGemini()) return reguliere("Clé Gemini manquante : parties coupées à intervalles réguliers.");
  let s: z.infer<typeof Serie>;
  try {
    const raw = jsonIn(await geminiWatchYouTube(v.id, v.duration, prompt(v), v.id));
    lireAvecFormat(v.id, raw, "serie");
    s = Serie.parse((raw as { serie?: unknown }).serie);
  } catch (e) {
    if (e instanceof GeminiSurcharge) throw e;
    console.warn("[histoires] Gemini :", (e as Error).message);
    return reguliere("L'IA n'a pas pu regarder la vidéo : les parties sont coupées à intervalles réguliers.");
  }
  // Contrôles sans IA : début et fin dans la vidéo, assez de durée, coupures à l'intérieur.
  let debut = Math.max(0, Math.round(s.debut)), fin = Math.min(v.duration, Math.round(s.fin));
  if (fin - debut < LIMITES.histoires.dureeMin) { debut = 0; fin = v.duration; }
  const coupures = [...new Set(s.coupures.map(Math.round))].filter((t) => t > debut && t < fin).sort((a, b) => a - b);
  console.info(`[histoires] ${v.id} : de ${debut} s à ${fin} s, ${coupures.length} coupures`);
  return { ok: true, value: { creeLe, avertissement: null, histoires: [{ start: debut, end: fin, titre: s.titre, resume: s.resume, suspense: coupures }] } };
}
