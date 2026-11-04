import "server-only";
import { cacheGet, db } from "./db";
import { lotSuivant, propositions } from "./lots";
import { formule } from "./quota";
import type { ExtraitsResult } from "./ai/extraits";
import type { Extrait } from "./types";
import LIMITES from "@/config/limites.json";

// Le lot de chaque personne pour chaque vidéo. Une analyse (le grand choix de passages) est partagée par tout le monde
// pendant 7 jours ; la personne paie une vidéo la première fois qu'elle reçoit son lot, puis rouvre gratuitement.

const GARDE_MS = LIMITES.analyse.conservationJours * 86400_000;

/** Une vidéo de plus d'1 h compte pour 2, de plus de 2 h pour 3. */
export const coutVideo = (duree: number) => Math.max(1, Math.ceil(duree / (LIMITES.analyse.heuresParVideo * 3600)));

export function analyseDe(videoId: string): ExtraitsResult | null {
  const r = cacheGet<ExtraitsResult>(`extraits:${videoId}`);
  return r && { ...r, creeLe: r.creeLe ?? 0 };
}

/** Lot déjà reçu par la personne pour l'analyse en cours de cette vidéo, sinon null. */
export function lotDe(user: string, videoId: string, creeLe: number): number | null {
  const row = db().prepare("SELECT lot, at FROM lots WHERE video = ? AND user = ?").get(videoId, user) as { lot: number; at: number } | undefined;
  return row && row.at >= creeLe && row.at > Date.now() - GARDE_MS ? row.lot : null;
}

/** Donne un lot à la personne : les 10 premières ont le lot 0, les 10 suivantes le lot 1, etc. */
export function attribuerLot(user: string, videoId: string, creeLe: number): number {
  const { n } = db().prepare("SELECT COUNT(*) AS n FROM lots WHERE video = ? AND at >= ? AND user != ?").get(videoId, creeLe, user) as { n: number };
  const lot = lotSuivant(n, LIMITES.analyse.personnesParLot);
  db().prepare("INSERT OR REPLACE INTO lots (video, user, lot, at) VALUES (?, ?, ?, ?)").run(videoId, user, lot, Date.now());
  return lot;
}

/** Les passages que la personne voit pour cette vidéo, selon son lot et sa formule. */
export function passagesDe(user: string, videoId: string, r: ExtraitsResult, lot: number): Extrait[] {
  return propositions(r.extraits, lot, `${videoId}:${r.creeLe}`, formule().shortsParVideo);
}
