// Montage auto (2.0) : au lieu d'un seul cadrage pour tout le Short, le cadre change d'un plan à l'autre. Gemini note,
// pendant le visionnage (visionnage.ts), qui compte à l'écran et où ; on recale ses changements sur les vrais
// changements de plan (détectés par FFmpeg, à l'image près) ou sur les débuts de phrase (sous-titres), puis FFmpeg
// monte chaque morceau :
// - « un » : plein écran vertical sur la personne qui parle (ou la principale dans un plan de groupe) ;
// - « duo » : écran coupé, une personne en haut, l'autre en bas (deux personnes éloignées qui se parlent) ;
// - « rien » : personne à suivre (décor, texte, foule de loin) : l'image plus large avec des bandes noires.

export type Mode = "un" | "duo" | "rien";
/** Un changement noté par Gemini : à partir de `t` (secondes depuis le début de la vidéo), le cadre suit `x` (0 à
 *  gauche, 1 à droite) ; en duo, `x` va en haut et `x2` en bas. */
export type Plan = { t: number; mode: Mode; x: number; x2?: number };
/** Un morceau du Short, en secondes depuis le début du Short. */
export type Morceau = { a: number; b: number; mode: Mode; x: number; x2: number };

const borne = (x: unknown, def = 0.5) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : def);

/** Lit la réponse de Gemini : [[t, "un", x], [t, "duo", x, x2], [t, "rien"]], ou des objets { t, mode, x, x2 }.
 *  Ce qui est mal formé est ignoré. */
export function lirePlans(raw: unknown): Plan[] {
  if (!Array.isArray(raw)) return [];
  const out: Plan[] = [];
  for (const e of raw) {
    const [t, mode, x, x2] = Array.isArray(e) ? e : [e?.t, e?.mode, e?.x, e?.x2];
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) continue;
    const m: Mode = mode === "duo" ? "duo" : mode === "rien" ? "rien" : "un";
    if (m === "duo" && typeof x2 !== "number") out.push({ t, mode: "un", x: borne(x) });
    else out.push({ t, mode: m, x: borne(x), ...(m === "duo" ? { x2: borne(x2) } : {}) });
  }
  return out.sort((p, q) => p.t - q.t);
}

/** Les morceaux d'un passage [start, end] de la vidéo. `coupes` : les changements de plan détectés dans le fichier, en
 *  secondes depuis le début du passage ; `phrases` : les débuts de phrase, en secondes depuis le début de la vidéo. */
export function morceaux(plans: Plan[], start: number, end: number, coupes: number[], phrases: number[], defautX = 0.5): Morceau[] {
  const len = end - start;
  const avant = plans.filter((p) => p.t <= start).at(-1);
  const pendant = plans.filter((p) => p.t > start && p.t < end);
  const premier: Plan = avant ?? pendant[0] ?? { t: start, mode: "rien", x: defautX };
  // Gemini ne voit qu'une image toutes les 2 à 4 s : son changement est recalé sur le vrai changement de plan le plus
  // proche (il a souvent un peu de retard), sinon sur le début de phrase le plus proche (quand l'autre répond).
  const proche = (cible: number, liste: number[], avantMax: number, apresMax: number) =>
    liste.filter((c) => c >= cible - avantMax && c <= cible + apresMax).sort((a, b) => Math.abs(a - cible) - Math.abs(b - cible))[0];
  const etapes = [{ a: 0, plan: premier }];
  for (const p of pendant) {
    const t = p.t - start;
    const a = proche(t, coupes, 2.5, 1) ?? (proche(p.t, phrases, 1.5, 1) ?? p.t) - start;
    if (a > 0.3 && a < len - 0.3) etapes.push({ a, plan: p });
  }
  etapes.sort((p, q) => p.a - q.a);
  const out: Morceau[] = [];
  for (const [i, e] of etapes.entries()) {
    const b = etapes[i + 1]?.a ?? len;
    const m: Morceau = { a: e.a, b, mode: e.plan.mode, x: e.plan.x, x2: e.plan.x2 ?? e.plan.x };
    const prev = out.at(-1);
    // Pareil que le morceau d'avant : on prolonge. Un morceau de moins de 0,8 s ferait un flash : il rejoint le précédent.
    if (prev && ((prev.mode === m.mode && Math.abs(prev.x - m.x) < 0.04 && Math.abs(prev.x2 - m.x2) < 0.04) || b - e.a < 0.8)) prev.b = b;
    else out.push(m);
  }
  if (out.length > 1 && out[0].b - out[0].a < 0.8) { out[1].a = 0; out.shift(); }
  return out.map((m) => ({ ...m, a: round(m.a), b: round(m.b) }));
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Une valeur qui change d'un morceau à l'autre, en expression FFmpeg évaluée à chaque image (t = temps du Short). */
function selon(ms: Morceau[], v: (m: Morceau) => string): string {
  return ms.slice(0, -1).reduceRight((suite, m) => `if(lt(t\\,${m.b})\\,${v(m)}\\,${suite})`, v(ms.at(-1)!));
}
/** Vrai (1) pendant les morceaux d'un mode, en expression FFmpeg. */
const pendantMode = (ms: Morceau[], mode: Mode) => ms.filter((m) => m.mode === mode).map((m) => `between(t\\,${m.a}\\,${m.b - 0.001})`).join("+") || "0";

/** Le filtre FFmpeg du montage auto, sortie 1080×1920. Les trois mises en page sont calculées en continu (rien n'est
 *  gardé en mémoire) et on affiche, à chaque image, celle du morceau en cours. */
export function filtreMontage(ms: Morceau[]): string {
  const x = selon(ms, (m) => m.x.toFixed(2)), x2 = selon(ms, (m) => m.x2.toFixed(2));
  // Duo : chaque moitié (1080×960) zoome sur une personne, le haut du cadre un peu au-dessus du milieu (les visages).
  const moitie = (cx: string, nom: string) => `crop=w=ih*0.7*9/8:h=ih*0.7:x=(iw-ow)*(${cx}):y=(ih-oh)*0.3,scale=1080:960,setsar=1[${nom}]`;
  return [
    "[0:v]fps=30,split=4[s1][s2][s3][s4]",
    `[s1]crop=w=min(iw\\,ih*3/4):h=min(ih\\,iw*4/3):x=(iw-ow)*(${x}),scale=1080:1440,pad=1080:1920:0:240:black,setsar=1[large]`,
    `[s2]crop=w=min(iw\\,ih*9/16):h=ih:x=(iw-ow)*(${x}),scale=1080:1920,setsar=1[un]`,
    `[s3]${moitie(x, "haut")}`,
    `[s4]${moitie(x2, "bas")}`,
    "[haut][bas]vstack[duo]",
    `[large][un]overlay=enable=${pendantMode(ms, "un")}[t1]`,
    `[t1][duo]overlay=enable=${pendantMode(ms, "duo")},setsar=1[vout]`,
  ].join(";");
}
