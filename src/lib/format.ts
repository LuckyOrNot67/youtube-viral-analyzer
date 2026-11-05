import "server-only";
import * as z from "zod/v4";
import { cacheGet, cacheSet, db } from "./db";
import LIMITES from "@/config/limites.json";

// Format de sortie d'une vidéo. Recadrer en vertical marche pour une personne face caméra, pas pour un écran
// partagé, un plan large ou deux personnes éloignées : on n'y verrait presque rien. Gemini le dit en regardant la
// vidéo (avis gardé pour tout le monde) et son conseil s'applique par défaut. La personne peut choisir un autre
// cadrage, séparément pour les Shorts et pour les histoires, et en changer tant qu'elle n'a rien créé : ensuite tout
// sort dans le même cadrage.

/** « vertical » : plein écran recadré au milieu ; « bandes » : le milieu de l'image, plus large, avec des bandes noires
 *  en haut et en bas (comme Remakeit) ; « horizontal » : l'image entière. */
export type Format = "vertical" | "bandes" | "horizontal";
export type Sorte = "shorts" | "histoires";
/** `centreX` : où sont les personnes ou le sujet dans la largeur de l'image (0 à gauche, 0,5 au milieu, 1 à droite). */
export type Conseil = { format: Format; raison: string; centreX?: number };

/** À ajouter à chaque demande où Gemini regarde la vidéo : il donne son avis sur le format en même temps. */
export const QUESTION_FORMAT = `"format": le cadrage pour TikTok, qui est vertical. Préfère toujours le vertical, et ne choisis "horizontal" qu'en tout dernier recours. "vertical" si l'essentiel reste visible en plein écran 9:16 (une personne face caméra, un sujet assez groupé) ; sinon "bandes" : une image plus large (3:4), centrée sur les personnes, avec une petite bande noire en haut et en bas (deux personnes côte à côte, un plateau, un plan un peu large) ; "horizontal" seulement si c'est vraiment impossible autrement, parce que l'essentiel occupe toute la largeur (écran partagé avec la personne d'un côté et l'écran de l'autre, texte ou démonstration d'un bord à l'autre)
"raison_format": "pourquoi, une phrase courte, en français"
"centre_x": où se trouvent les personnes ou le sujet principal dans la largeur de l'image, la plupart du temps (0 = bord gauche, 0.5 = milieu, 1 = bord droit)`;

const Avis = z.object({ format: z.enum(["vertical", "bandes", "horizontal"]), raison_format: z.string().default(""), centre_x: z.number().min(0).max(1).optional() });

/** Lit la réponse de Gemini : { format, raison_format, <cle>: [...] }, ou l'ancien tableau seul. Garde l'avis. */
export function lireAvecFormat(videoId: string, raw: unknown, cle: string): unknown {
  if (Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  const avis = Avis.safeParse(o);
  if (avis.success) noterConseil(videoId, { format: avis.data.format, raison: avis.data.raison_format, centreX: avis.data.centre_x });
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

/** Des Shorts (ou des parties) déjà créés dans un cadrage : on ne le change plus, pour que tout sorte pareil. */
export function verrouille(uid: string, videoId: string, sorte: Sorte): boolean {
  const r = db().prepare(`SELECT 1 FROM shorts WHERE user = ? AND video = ? AND etat != 'erreur' AND partie IS ${sorte === "histoires" ? "NOT " : ""}NULL LIMIT 1`).get(uid, videoId);
  return Boolean(r);
}

/** Change le cadrage tant que rien n'a été créé ; ensuite le choix ne bouge plus. Renvoie le cadrage en vigueur. */
export function choisir(uid: string, videoId: string, sorte: Sorte, f: Format): Format {
  if (!verrouille(uid, videoId, sorte)) {
    db().prepare("INSERT OR REPLACE INTO choix_format (user, video, sorte, format, at) VALUES (?, ?, ?, ?, ?)").run(uid, videoId, sorte, f, Date.now());
  }
  return cadrageDe(uid, videoId, sorte);
}

/** Le cadrage qui s'applique : le choix de la personne, sinon le conseil de l'IA, sinon le plein écran vertical. */
export const cadrageDe = (uid: string, videoId: string, sorte: Sorte): Format => choixDe(uid, videoId, sorte) ?? conseilDe(videoId)?.format ?? "vertical";

/** Ce que l'écran doit savoir : l'avis de l'IA, le choix fait et si on peut encore en changer. */
export const formatPour = (uid: string, videoId: string, sorte: Sorte) => ({ conseil: conseilDe(videoId), choix: choixDe(uid, videoId, sorte), verrouille: verrouille(uid, videoId, sorte) });
