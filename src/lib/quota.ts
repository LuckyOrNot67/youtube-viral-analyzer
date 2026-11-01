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
export type Kind = keyof typeof LIMITES.parUtilisateurParJour;

const LABEL: Record<Kind, string> = {
  chaines: "analyses de chaîne", sujets: "recherches par sujet", commentaires: "analyses de commentaires", extraits: "recherches d'extraits", shorts: "Shorts",
};

export function usageOf(user: string, kind: Kind): number {
  const row = db().prepare("SELECT n FROM usage WHERE day = ? AND user = ? AND kind = ?").get(quotaDay(), user, kind) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function assertUsage(user: string, kind: Kind) {
  const lim = LIMITES.parUtilisateurParJour[kind];
  if (usageOf(user, kind) >= lim) throw new QuotaError(`Tu as utilisé tes ${lim} ${LABEL[kind]} d'aujourd'hui. Ça repart demain.`, "utilisateur");
}

export function countUsage(user: string, kind: Kind) {
  db().prepare("INSERT INTO usage (day, user, kind, n) VALUES (?, ?, ?, 1) ON CONFLICT (day, user, kind) DO UPDATE SET n = n + 1").run(quotaDay(), user, kind);
}

export function usageSummary(user: string) {
  return (Object.keys(LIMITES.parUtilisateurParJour) as Kind[]).map((k) => ({ kind: k, label: LABEL[k], used: usageOf(user, k), max: LIMITES.parUtilisateurParJour[k] }));
}
