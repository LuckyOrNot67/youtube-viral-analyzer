// Score d'explosion : pur (sans réseau ni base) pour être testé et reproductible.
// Principe : comparer chaque vidéo aux vidéos de la MÊME chaîne, du même format et d'un âge comparable,
// plutôt qu'au nombre d'abonnés seul (arrondi par l'API, parfois masqué).

import type { Confiance, Score, Video } from "./types";

export const POIDS = { surperformance: 0.5, vitesse: 0.25, engagement: 0.15, recence: 0.1 };
/** En dessous, quelques likes ne doivent pas suffire à obtenir un gros score. */
export const VUES_MIN = 5000;
const PLAFOND_PEU_DE_VUES = 5;
/** Poids (en vues) de la moyenne de la chaîne dans l'engagement : lisse les vidéos qui ont peu de vues. */
const LISSAGE = 2000;
/** Les Shorts durent jusqu'à 3 min ; l'API ne dit pas si une vidéo est un Short, on le déduit de la durée. */
export const SHORT_MAX = 180;

const DAY = 86400_000;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const ageDays = (v: Pick<Video, "publishedAt">, now: number) => Math.max((now - Date.parse(v.publishedAt)) / DAY, 1 / 24);
const isShort = (v: Pick<Video, "duration">) => v.duration > 0 && v.duration <= SHORT_MAX;
const engagementOf = (v: Video) => (v.likes === null && v.comments === null ? null : ((v.likes ?? 0) + 2 * (v.comments ?? 0)) / Math.max(v.views, 1));

/** Vidéos comparables : même chaîne, même format, âge entre la moitié et le double (élargi au tiers / triple
 *  s'il y en a moins de 10) ; sinon toutes celles du même format de plus de 2 jours. */
export function comparables(v: Video, pool: Video[], now: number): Video[] {
  const a = ageDays(v, now);
  const same = pool.filter((p) => p.id !== v.id && p.channelId === v.channelId && isShort(p) === isShort(v));
  const within = (k: number) => same.filter((p) => { const pa = ageDays(p, now); return pa >= a / k && pa <= a * k; });
  const near = within(2);
  if (near.length >= 10) return near;
  const wider = within(3);
  if (wider.length >= 5) return wider;
  return same.filter((p) => ageDays(p, now) >= 2);
}

export type Snapshot = { at: number; views: number };

/** Vues par jour : mesurées entre deux relevés espacés d'au moins 12 h si on en a, sinon moyenne depuis la publication. */
export function velocity(v: Video, snaps: Snapshot[], now: number): { vpd: number; mesuree: boolean } {
  const s = [...snaps].sort((a, b) => a.at - b.at);
  const last = s[s.length - 1];
  const prev = last && [...s].reverse().find((x) => last.at - x.at >= 12 * 3600_000);
  if (last && prev && last.views >= prev.views) return { vpd: ((last.views - prev.views) / (last.at - prev.at)) * DAY, mesuree: true };
  return { vpd: v.views / ageDays(v, now), mesuree: false };
}

export function scoreVideo(v: Video, pool: Video[], opts: { now: number; snaps?: Snapshot[]; subs?: number | null }): Score {
  const { now } = opts;
  const age = ageDays(v, now);
  const comp = comparables(v, pool, now);
  const base = median(comp.map((p) => p.views));
  const ratio = base ? v.views / base : null;

  // 1. Surperformance : log2 du rapport à la normale. 0,5× → 0 ; 1× → 0,25 ; 2× → 0,5 ; 8× → 1.
  const S = ratio === null ? 0.25 : clamp((Math.log2(Math.max(ratio, 1e-6)) + 1) / 4);
  // 2. Vitesse : 100 vues/jour → 0 ; 1 million/jour → 1 (échelle log).
  const { vpd, mesuree } = velocity(v, opts.snaps ?? [], now);
  const V = clamp((Math.log10(Math.max(vpd, 1)) - 2) / 4);
  // 3. Engagement, lissé vers celui de la chaîne puis rapporté à lui : 0,5× → 0 ; 1× → 0,33 ; 4× → 1.
  const eRaw = engagementOf(v);
  const eMed = median(comp.map(engagementOf).filter((x): x is number => x !== null));
  let E = 0.33, eShr: number | null = null;
  if (eRaw !== null) {
    const prior = eMed ?? 0.04;
    eShr = (eRaw * v.views + prior * LISSAGE) / (v.views + LISSAGE);
    E = clamp((Math.log2(eShr / prior) + 1) / 3);
  }
  // 4. Récence : pleine jusqu'à 7 jours, puis baisse jusqu'à 0 à 90 jours.
  const R = age <= 7 ? 1 : clamp(1 - (age - 7) / 83);

  let score = 10 * (POIDS.surperformance * S + POIDS.vitesse * V + POIDS.engagement * E + POIDS.recence * R);
  if (v.views < VUES_MIN) score = Math.min(score, PLAFOND_PEU_DE_VUES);
  score = Math.round(score * 10) / 10;

  const { confiance, confianceRaison } = confidence(comp.length, age, v);
  return {
    score, label: labelOf(score), confiance, confianceRaison,
    raisons: reasons({ v, ratio, base, n: comp.length, vpd, mesuree, eShr, eMed, subs: opts.subs ?? null, age }),
    parts: { surperformance: S, vitesse: V, engagement: E, recence: R },
    base: { median: base, n: comp.length, ratio },
    vuesParJour: vpd, vitesseMesuree: mesuree, engagement: eRaw, ageJours: age, isShort: isShort(v),
  };
}

export function labelOf(score: number) {
  if (score >= 8) return "Forte surperformance";
  if (score >= 6.5) return "Surperformance";
  if (score >= 5) return "Au-dessus de la normale";
  return "Normale";
}

function confidence(n: number, age: number, v: Video): { confiance: Confiance; confianceRaison: string | null } {
  if (n < 5) return { confiance: "basse", confianceRaison: `seulement ${n} vidéo${n > 1 ? "s" : ""} comparable${n > 1 ? "s" : ""} sur la chaîne` };
  if (age < 2) return { confiance: "basse", confianceRaison: "vidéo publiée il y a moins de 48 h" };
  if (v.likes === null) return { confiance: "moyenne", confianceRaison: "likes masqués" };
  if (n < 10) return { confiance: "moyenne", confianceRaison: `${n} vidéos comparables (il en faut 10 pour une confiance haute)` };
  return { confiance: "haute", confianceRaison: null };
}

export const fmtNum = (x: number) => {
  const a = Math.abs(x);
  const f = (n: number, u: string) => `${(Math.round(n * 10) / 10).toString().replace(".", ",")} ${u}`;
  if (a >= 1e9) return f(x / 1e9, "Md");
  if (a >= 1e6) return f(x / 1e6, "M");
  if (a >= 1e4) return `${Math.round(x / 1e3)} k`;
  if (a >= 1e3) return f(x / 1e3, "k");
  return String(Math.round(x));
};
const fmtX = (r: number) => `${(Math.round(r * 10) / 10).toString().replace(".", ",")}×`;

function reasons(a: { v: Video; ratio: number | null; base: number | null; n: number; vpd: number; mesuree: boolean; eShr: number | null; eMed: number | null; subs: number | null; age: number }): string[] {
  const out: string[] = [];
  if (a.ratio !== null && a.base !== null) {
    if (a.ratio >= 1.5) out.push(`${fmtX(a.ratio)} les vues habituelles de la chaîne (${fmtNum(a.base)} en médiane sur ${a.n} vidéos comparables)`);
    else if (a.ratio >= 0.8) out.push(`Dans la normale de la chaîne (${fmtNum(a.base)} vues en médiane)`);
    else out.push(`En dessous de la normale de la chaîne (${fmtNum(a.base)} vues en médiane)`);
  } else out.push("Pas assez de vidéos sur la chaîne pour la comparer");
  out.push(a.mesuree ? `${fmtNum(a.vpd)} vues par jour en ce moment (mesuré entre deux relevés)` : `${fmtNum(a.vpd)} vues par jour en moyenne depuis sa sortie`);
  if (a.eShr !== null && a.eMed) {
    const r = a.eShr / a.eMed;
    if (r >= 1.4) out.push(`${fmtX(r)} plus de likes et commentaires par vue que d'habitude`);
    else if (r <= 0.7) out.push("Moins de likes et commentaires par vue que d'habitude");
  }
  if (a.subs && a.v.views >= a.subs * 3) out.push(`${fmtX(a.v.views / a.subs)} le nombre d'abonnés de la chaîne`);
  return out.slice(0, 3);
}

/** Classe une liste : score décroissant, rang 1 = meilleur. */
export function rank<T extends { s: Score }>(xs: T[]): (T & { rang: number })[] {
  return [...xs].sort((a, b) => b.s.score - a.s.score || b.s.vuesParJour - a.s.vuesParJour).map((x, i) => ({ ...x, rang: i + 1 }));
}
