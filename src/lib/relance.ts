import "server-only";
import { findExtraits } from "./ai/extraits";
import { findHistoires } from "./ai/histoires";
import { autoriserSecours, GeminiSurcharge } from "./ai/models";
import { db } from "./db";
import { envoyerEmail } from "./email";
import type { Sorte } from "./format";
import type { Video } from "./types";
import LIMITES from "@/config/limites.json";

// Gemini surchargé : le serveur réessaie tout seul toutes les 2 minutes. Au bout de quelques minutes, il passe au
// modèle de secours, plus cher, pour que personne n'attende trop. Dès que l'analyse est prête, elle est gardée pour
// tout le monde (l'écran qui attend la récupère seul) et les personnes qui ont laissé leur email sont prévenues.
// Leur email est effacé juste après l'envoi.

const INTERVALLE = 2 * 60_000;
const SECOURS_MS = LIMITES.gemini.secoursApresMinutes * 60_000;
const ABANDON_MS = LIMITES.gemini.abandonApresMinutes * 60_000;
const g = globalThis as unknown as { __yvaRelances?: Set<string> };
const enCours = (g.__yvaRelances ??= new Set());

export function relancer(sorte: Sorte, video: Video, duree = 0) {
  const cle = `${sorte}:${video.id}`;
  if (enCours.has(cle)) return;
  enCours.add(cle);
  const debut = Date.now();
  const fin = () => { enCours.delete(cle); autoriserSecours(video.id, false); };
  const essai = async () => {
    if (Date.now() - debut >= SECOURS_MS) autoriserSecours(video.id, true);
    try {
      if (sorte === "shorts") await findExtraits(video);
      else await findHistoires(video, duree);
      fin();
      await prevenir(sorte, video, true);
    } catch (e) {
      if (e instanceof GeminiSurcharge && Date.now() - debut < ABANDON_MS) { setTimeout(essai, INTERVALLE); return; }
      fin();
      console.warn(`[relance] ${cle} abandonnée :`, (e as Error).message);
      await prevenir(sorte, video, false);
    }
  };
  setTimeout(essai, INTERVALLE);
}

export const relanceEnCours = (sorte: Sorte, videoId: string) => enCours.has(`${sorte}:${videoId}`);

export function aPrevenir(email: string, sorte: Sorte, videoId: string, origine: string) {
  db().prepare("INSERT OR REPLACE INTO a_prevenir (email, video, sorte, origine, at) VALUES (?, ?, ?, ?, ?)").run(email, videoId, sorte, origine, Date.now());
}

async function prevenir(sorte: Sorte, video: Video, ok: boolean) {
  const rows = db().prepare("SELECT email, origine FROM a_prevenir WHERE video = ? AND sorte = ?").all(video.id, sorte) as { email: string; origine: string }[];
  const quoi = sorte === "shorts" ? "tes Shorts" : "tes histoires en parties";
  for (const r of rows) {
    const lien = `${r.origine}/video/${video.id}`;
    await envoyerEmail(r.email,
      ok ? `C'est prêt : ${quoi} pour « ${video.title.slice(0, 60)} »` : `On n'a pas pu analyser « ${video.title.slice(0, 60)} »`,
      ok ? `Bonne nouvelle : l'IA a fini de regarder « ${video.title} ».\n\nOuvre la vidéo et clique à nouveau pour voir ${quoi} : ${lien}\n\nViral Analyzer`
        : `L'IA est restée surchargée pendant 30 minutes et n'a pas pu regarder « ${video.title} ».\n\nRéessaie un peu plus tard : ${lien}\n\nViral Analyzer`);
  }
  db().prepare("DELETE FROM a_prevenir WHERE video = ? AND sorte = ?").run(video.id, sorte);
}
