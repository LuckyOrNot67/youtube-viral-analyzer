import "server-only";
import * as z from "zod/v4";
import { cacheGet, cacheSet, db } from "./db";
import LIMITES from "@/config/limites.json";

// Format de sortie d'une vidéo. Recadrer en vertical marche pour une personne face caméra, pas pour un écran
// partagé, un plan large ou deux personnes éloignées : on n'y verrait presque rien. Gemini le dit en regardant la
// vidéo (avis gardé pour tout le monde), la personne choisit une fois pour toutes, séparément pour les Shorts et
// pour les histoires (on peut vouloir les Shorts en horizontal et les parties en vertical), et tout sort dans ce format.

/** « vertical » : plein écran recadré au milieu ; « bandes » : le milieu de l'image, plus large, avec des bandes noires
 *  en haut et en bas (comme Remakeit) ; « horizontal » : l'image entière. */
export type Format = "vertical" | "bandes" | "horizontal";
export type Sorte = "shorts" | "histoires";
export type Conseil = { format: Format; raison: string };

/** À ajouter à chaque demande où Gemini regarde la vidéo : il donne son avis sur le format en même temps. */
export const QUESTION_FORMAT = `"format": "vertical" si l'essentiel reste visible en recadrant l'image au centre en 9:16 (une personne face caméra, un sujet au milieu) ; "bandes" si l'essentiel tient dans le milieu de l'image en 3:4, plus large (deux personnes côte à côte, un plan un peu large) ; "horizontal" seulement s'il faut toute la largeur (écran partagé avec la personne d'un côté et l'écran de l'autre, texte ou démonstration sur toute la largeur)
"raison_format": "pourquoi, une phrase courte, en français"`;

const Avis = z.object({ format: z.enum(["vertical", "bandes", "horizontal"]), raison_format: z.string().default("") });

/** Lit la réponse de Gemini : { format, raison_format, <cle>: [...] }, ou l'ancien tableau seul. Garde l'avis. */
export function lireAvecFormat(videoId: string, raw: unknown, cle: string): unknown {
  if (Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  const avis = Avis.safeParse(o);
  if (avis.success) noterConseil(videoId, { format: avis.data.format, raison: avis.data.raison_format });
  return o?.[cle] ?? [];
}

function noterConseil(videoId: string, c: Conseil) {
  const key = `format:${videoId}`;
  if (!cacheGet<Conseil>(key)) cacheSet(key, c, LIMITES.cache.extraitsHeures);
}

export const conseilDe = (videoId: string) => cacheGet<Conseil>(`format:${videoId}`);

export function choixDe(uid: string, videoId: string, sorte: Sorte): Format | null {
  const r = db().prepare("SELECT format FROM choix_format WHERE user = ? AND video = ? AND sorte = ?").get(uid, videoId, sorte) as { format: Format } | undefined;
  return r?.format ?? null;
}

/** Définitif : un second choix ne change rien. Renvoie le choix enregistré. */
export function choisir(uid: string, videoId: string, sorte: Sorte, f: Format): Format {
  db().prepare("INSERT OR IGNORE INTO choix_format (user, video, sorte, format, at) VALUES (?, ?, ?, ?, ?)").run(uid, videoId, sorte, f, Date.now());
  return choixDe(uid, videoId, sorte)!;
}

/** Ce que l'écran doit savoir : l'avis de l'IA et le choix déjà fait pour ces Shorts ou ces histoires. */
export const formatPour = (uid: string, videoId: string, sorte: Sorte) => ({ conseil: conseilDe(videoId), choix: choixDe(uid, videoId, sorte) });
