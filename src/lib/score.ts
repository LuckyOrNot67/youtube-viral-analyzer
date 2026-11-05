// Score de viralité : pur (sans réseau ni base) pour être testé et reproductible.
// Un barème en points, lisible par tout le monde. Le temps compte d'abord : 17,8 M de vues en 2 mois valent bien
// plus que 22,5 M en 2 ans, et le but est de poster ce qui marche en ce moment.
//   - Vues par jour (0 à 5) : les vues rapportées au temps depuis la sortie. Une vidéo de Squeezie part forcément haut.
//   - Par rapport à d'habitude (−1,5 à +3) : comparée aux vidéos de la MÊME chaîne, du même format et d'un âge proche.
//   - Likes (0 à +0,5) et commentaires (0 à +0,25) : un petit coup de pouce, par vue, comparés à la chaîne. Jamais de malus : une vidéo
//     qui devient virale touche des gens qui ne likent pas, son taux baisse justement parce qu'elle marche.
//   - Fraîcheur (−1 à +2) : une vidéo récente compte plus ; au-delà d'un an, elle ne peut plus être en tête.
// Le total est ramené entre 0 et 10.

import type { Confiance, Score, Video } from "./types";

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

const likesParVue = (v: Video) => (v.likes === null ? null : v.likes / Math.max(v.views, 1));
const comsParVue = (v: Video) => (v.comments === null ? null : v.comments / Math.max(v.views, 1));
/** Taux lissé vers celui de la chaîne : une vidéo à peu de vues ne gagne pas de points sur trois likes. */
const lisse = (x: number, v: Video, prior: number) => (x * v.views + prior * LISSAGE) / (v.views + LISSAGE);
const pct = (r: number) => `${r >= 1 ? "+" : "−"}${Math.round(Math.abs(r - 1) * 100)} %`;

/** Points « par rapport à d'habitude » : +20 % → +1, ×2 → +2, ×4 → +3 ; −20 % → −1, ÷2 → −1,5. */
export function pointsHabitude(r: number): number {
  if (r >= 4) return 3;
  if (r >= 2) return 2;
  if (r >= 1.2) return 1;
  if (r > 0.8) return 0;
  if (r > 0.5) return -1;
  return -1.5;
}

/** Likes ou commentaires par vue, comparés à la chaîne : +20 % → le bonus entier (multiplié par son plafond), sinon 0. */
const pointsTaux = (r: number) => (r >= 1.2 ? 1 : 0);

export function scoreVideo(v: Video, pool: Video[], opts: { now: number; snaps?: Snapshot[]; subs?: number | null }): Score {
  const { now } = opts;
  const age = ageDays(v, now);
  const comp = comparables(v, pool, now);
  const base = median(comp.map((p) => p.views));
  const ratio = base ? v.views / base : null;
  const points: Score["points"] = [];

  // 1. Vues par jour depuis la sortie (pas le rythme du moment, qui retombe toujours après les premiers jours) :
  //    100 → 0 ; 1 000 → 1,25 ; 10 000 → 2,5 ; 100 000 → 3,75 ; 1 M et plus → 5.
  const moyenne = v.views / age;
  const parJour = clamp((Math.log10(Math.max(moyenne, 1)) - 2) * 1.25, 0, 5);
  points.push({ critere: "Vues par jour", points: parJour, detail: `${fmtNum(v.views)} vues en ${fmtJours(age)}, soit ${fmtNum(moyenne)} par jour` });

  // 2. Par rapport à d'habitude. Une vidéo bien plus jeune que celles à qui on la compare n'a pas encore fini de
  //    faire ses vues : elle peut gagner des points, pas en perdre.
  if (ratio !== null && base !== null) {
    const ageComp = median(comp.map((p) => ageDays(p, now))) ?? age;
    const tropJeune = ageComp > 2 * age;
    const pts = tropJeune ? Math.max(0, pointsHabitude(ratio)) : pointsHabitude(ratio);
    points.push({ critere: "Par rapport à d'habitude", points: pts, detail: `${pct(ratio)} par rapport aux ${fmtNum(base)} vues habituelles de la chaîne${tropJeune && pts === 0 ? " (vidéo encore jeune, pas de malus)" : ""}` });
  } else points.push({ critere: "Par rapport à d'habitude", points: 0, detail: "pas assez de vidéos sur la chaîne pour comparer" });

  // 3. Likes et commentaires par vue, comparés à la chaîne (lissés, pour ne pas récompenser trois likes).
  for (const [critere, f, max] of [["Likes", likesParVue, 0.5], ["Commentaires", comsParVue, 0.25]] as const) {
    const x = f(v), med = median(comp.map(f).filter((y): y is number => y !== null));
    if (x === null || !med) { points.push({ critere, points: 0, detail: x === null ? "masqués" : "pas de comparaison possible" }); continue; }
    const r = lisse(x, v, med) / med;
    points.push({ critere, points: pointsTaux(r) * max, detail: `${pct(r)} par vue par rapport à d'habitude` });
  }

  // 4. Fraîcheur : une semaine +2 ; un mois +1,5 ; 3 mois +1 ; 6 mois +0,5 ; un an 0 ; plus d'un an −1.
  const fraicheur = age <= 7 ? 2 : age <= 31 ? 1.5 : age <= 92 ? 1 : age <= 183 ? 0.5 : age <= 366 ? 0 : -1;
  points.push({ critere: "Fraîcheur", points: fraicheur, detail: `publiée ${age < 1 ? "aujourd'hui" : `il y a ${fmtJours(age)}`}` });

  let score = clamp(points.reduce((t, p) => t + p.points, 0), 0, 10);
  if (v.views < VUES_MIN) score = Math.min(score, PLAFOND_PEU_DE_VUES);
  score = Math.round(score * 10) / 10;

  const { vpd, mesuree } = velocity(v, opts.snaps ?? [], now);
  const { confiance, confianceRaison } = confidence(comp.length, age, v);
  return {
    score, label: labelOf(score), confiance, confianceRaison,
    raisons: reasons({ v, ratio, base, n: comp.length, vpd, mesuree, subs: opts.subs ?? null }),
    points: points.map((p) => ({ ...p, points: Math.round(p.points * 10) / 10 })),
    base: { median: base, n: comp.length, ratio },
    vuesParJour: vpd, vitesseMesuree: mesuree, engagement: likesParVue(v), ageJours: age, isShort: isShort(v),
  };
}

const fmtJours = (j: number) => (j < 30 ? `${Math.round(j)} j` : j < 365 ? `${Math.round(j / 30)} mois` : `${(Math.round(j / 36.5) / 10).toString().replace(".", ",")} an${j >= 730 ? "s" : ""}`);

export function labelOf(score: number) {
  if (score >= 8) return "Explose";
  if (score >= 6.5) return "Très bonne";
  if (score >= 5) return "Bonne";
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

function reasons(a: { v: Video; ratio: number | null; base: number | null; n: number; vpd: number; mesuree: boolean; subs: number | null }): string[] {
  const out: string[] = [];
  if (a.ratio !== null && a.base !== null) {
    if (a.ratio >= 1.5) out.push(`${fmtX(a.ratio)} les vues habituelles de la chaîne (${fmtNum(a.base)} en médiane sur ${a.n} vidéos comparables)`);
    else if (a.ratio >= 0.8) out.push(`Dans la normale de la chaîne (${fmtNum(a.base)} vues en médiane)`);
    else out.push(`En dessous de la normale de la chaîne (${fmtNum(a.base)} vues en médiane)`);
  } else out.push("Pas assez de vidéos sur la chaîne pour la comparer");
  out.push(a.mesuree ? `${fmtNum(a.vpd)} vues par jour en ce moment (mesuré entre deux relevés)` : `${fmtNum(a.vpd)} vues par jour en moyenne depuis sa sortie`);
  if (a.subs && a.v.views >= a.subs * 3) out.push(`${fmtX(a.v.views / a.subs)} le nombre d'abonnés de la chaîne`);
  return out.slice(0, 3);
}

/** Classe une liste : score décroissant, rang 1 = meilleur. */
export function rank<T extends { s: Score }>(xs: T[]): (T & { rang: number })[] {
  return [...xs].sort((a, b) => b.s.score - a.s.score || b.s.vuesParJour - a.s.vuesParJour).map((x, i) => ({ ...x, rang: i + 1 }));
}
