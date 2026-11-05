import "server-only";
import { db, quotaDay } from "./db";
import LIMITES from "@/config/limites.json";

// Deux compteurs YouTube officiels : les unités (10 000 / jour) et les appels search.list (100 / jour, à part).
export type Bucket = "unites" | "recherches";

export class QuotaError extends Error {
  constructor(message: string, readonly scope: "global" | "utilisateur") { super(message); }
}

const max = (b: Bucket) => (b === "unites" ? LIMITES.global.unitesParJour : LIMITES.global.recherchesParJour);
const reserve = (b: Bucket) => (b === "unites" ? LIMITES.global.reserveUnites : LIMITES.global.reserveRecherches);

export function used(b: Bucket): number {
  const row = db().prepare("SELECT used FROM quota WHERE day = ? AND bucket = ?").get(quotaDay(), b) as { used: number } | undefined;
  return row?.used ?? 0;
}

/** Refuse avant l'appel si le quota du jour ne suffit plus (on garde une petite réserve). */
export function assertQuota(b: Bucket, cost: number) {
  if (used(b) + cost > max(b) - reserve(b)) {
    throw new QuotaError(b === "recherches"
      ? "Les recherches par sujet sont épuisées pour aujourd'hui. Réessaie demain, ou colle directement une chaîne."
      : "Le quota YouTube de l'app est épuisé pour aujourd'hui. Réessaie demain.", "global");
  }
}

export function spend(b: Bucket, cost: number, endpoint: string) {
  const before = used(b);
  db().prepare("INSERT INTO quota (day, bucket, used) VALUES (?, ?, ?) ON CONFLICT (day, bucket) DO UPDATE SET used = used + excluded.used").run(quotaDay(), b, cost);
  db().prepare("INSERT INTO quota_log (t, endpoint, cost, bucket) VALUES (?, ?, ?, ?)").run(Date.now(), endpoint, cost, b);
  for (const a of LIMITES.global.alertes) {
    if (before < a * max(b) && before + cost >= a * max(b)) console.warn(`[quota] ${b} : ${Math.round(a * 100)} % du quota du jour atteint`);
  }
}

export function quotaStatus() {
  return (["unites", "recherches"] as const).map((b) => ({ bucket: b, used: used(b), max: max(b) }));
}

// ===== Limites par personne (identifiant anonyme en cookie, en attendant les comptes) =====
// Deux compteurs suivent la formule : les recherches (par jour) et les vidéos analysées (par mois).
// Les Shorts sont inclus, plafonnés par vidéo.
export type Kind = "recherches" | "videos" | "histoires";
type NomFormule = "createur" | "expert" | "pro";
export type Formule = { id: NomFormule; nom: string; recherchesParJour: number; videosParMois: number; shortsParVideo: number; histoiresParMois: number };

/** La formule de la personne. Sans comptes ni paiement, c'est la même pour tout le monde. */
export function formule(): Formule {
  const F = LIMITES.formules;
  const id = (["createur", "expert", "pro"] as const).find((x) => x === process.env.FORMULE) ?? (F.parDefaut as NomFormule);
  return { id, ...F[id] };
}

const LABEL: Record<Kind, string> = { recherches: "recherches", videos: "vidéos analysées", histoires: "vidéos découpées en histoires" };
const parMois = (k: Kind) => k === "videos" || k === "histoires";
/** Période du compteur : le jour du quota YouTube, ou le mois pour les vidéos. */
const periode = (k: Kind) => (parMois(k) ? quotaDay().slice(0, 7) : quotaDay());

function limite(user: string, k: Kind): number {
  const f = formule();
  return k === "recherches" ? f.recherchesParJour : k === "videos" ? f.videosParMois : f.histoiresParMois;
}

export function usageOf(user: string, kind: Kind): number {
  const row = db().prepare("SELECT n FROM usage WHERE day = ? AND user = ? AND kind = ?").get(periode(kind), user, kind) as { n: number } | undefined;
  return row?.n ?? 0;
}

// Pour tester en local sans limite par personne (jamais en production). Les quotas YouTube restent appliqués.
const SANS_LIMITES = process.env.NODE_ENV !== "production" && process.env.SANS_LIMITES === "1";

export function assertUsage(user: string, kind: Kind, cost = 1) {
  if (SANS_LIMITES) return;
  const lim = limite(user, kind), used = usageOf(user, kind);
  if (used + cost <= lim) return;
  if (parMois(kind)) {
    throw new QuotaError(used < lim
      ? `Cette vidéo dure plus d'1 h : elle compte pour ${cost}, et il te reste ${lim - used} ${LABEL[kind]} ce mois-ci.`
      : `Tu as utilisé tes ${lim} ${LABEL[kind]} de ce mois-ci. Ça repart le mois prochain.`, "utilisateur");
  }
  throw new QuotaError(`Tu as utilisé tes ${lim} ${LABEL[kind]} d'aujourd'hui. Ça repart demain.`, "utilisateur");
}

export function countUsage(user: string, kind: Kind, cost = 1) {
  db().prepare("INSERT INTO usage (day, user, kind, n) VALUES (?, ?, ?, ?) ON CONFLICT (day, user, kind) DO UPDATE SET n = n + excluded.n").run(periode(kind), user, kind, cost);
}

export function usageSummary(user: string) {
  return { formule: formule(), compteurs: (["recherches", "videos", "histoires"] as const).map((k) => ({ kind: k, label: LABEL[k], used: usageOf(user, k), max: limite(user, k), periode: parMois(k) ? "mois" : "jour" })) };
}
