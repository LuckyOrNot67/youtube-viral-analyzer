// Montage auto (3.0) : le cadre se comporte comme un monteur. Pour chaque plan de la caméra, on repère toutes les
// personnes (leur corps et leur tête, et aussi les animaux), on les suit d'une image à l'autre, et on note chacune
// toutes les demi-secondes : est-ce qu'elle parle (sa bouche bouge pendant qu'on entend une voix), est-ce qu'elle fait
// de grands gestes, est-ce qu'elle est près de la caméra. La meilleure note prend le cadre :
// - « tete » : elle parle sans bouger : zoom sur la tête et les épaules ;
// - « corps » : elle fait un grand geste (ou on ne voit pas son visage) : tout son corps dans le cadre vertical ;
// - « duo » : deux personnes éloignées qui se répondent très vite : une en haut, l'autre en bas ;
// - « flou » : personne à l'écran (texte, animation) : l'image entière sur un fond flouté.
// Entre deux personnes (ou de la tête au corps), le cadre coupe net, comme un monteur ; quand il suit la même personne,
// il glisse en douceur. Le public assis au fond (petit, immobile, silencieux) ne prend jamais le cadre.
// Sources : FFmpeg (les changements de plan), scripts/personnes.py (corps, visages, bouche, gestes, voix), les
// sous-titres (débuts de phrase) et Gemini (ai/montage-ia.ts), qui ne sert plus qu'à départager.

export type Mode = "un" | "duo" | "rien";
/** Un changement noté par Gemini : à partir de `t` (secondes depuis le début du passage), le cadre suit `x` (0 à
 *  gauche, 1 à droite) ; en duo, `x` va en haut et `x2` en bas. */
export type Plan = { t: number; mode: Mode; x: number; x2?: number };
/** Ce qu'on voit et entend à `t` (secondes depuis le début du passage), positions et tailles entre 0 et 1.
 *  `c` : les corps [centre x, centre y, largeur, hauteur, confiance, classe (0 = personne), geste] ;
 *  `f` : les visages [centre x, centre y, largeur, hauteur, confiance, bouche] ; `voix` : le volume. */
export type Echantillon = { t: number; f: number[][]; c?: number[][]; voix?: number };
/** Une position du cadre à un instant ; entre deux positions d'un même morceau, le cadre glisse. */
export type Cle = { t: number; x: number; y: number; x2: number; y2: number };
/** Un morceau du Short, en secondes depuis le début du Short. */
export type Morceau = { a: number; b: number; mode: "tete" | "corps" | "duo" | "flou"; cles: Cle[] };

const borne = (x: unknown, def = 0.5) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : def);
const round = (n: number, p = 100) => Math.round(n * p) / p;
const mediane = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const moyenne = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

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

/** Changements de plan vus aux visages : d'une image à la suivante, plus aucun visage à la même place ni de la même
 *  taille (deux plans de mêmes couleurs, que FFmpeg ne voit pas toujours). Recalés sur un changement FFmpeg proche. */
export function coupesVisages(ech: Echantillon[], coupes: number[]): number[] {
  const out: number[] = [];
  const pareil = (f: number[], g: number[]) => Math.abs(f[0] - g[0]) < 0.06 && Math.abs(f[1] - g[1]) < 0.08 && f[3] / g[3] > 0.7 && f[3] / g[3] < 1.4;
  for (let i = 1; i < ech.length; i++) {
    const avant = ech[i - 1].f, apres = ech[i].f;
    // Des visages des deux côtés, et aucun qui se retrouve : la caméra a changé.
    if (!avant.length || !apres.length || apres.some((g) => avant.some((f) => pareil(f, g)))) continue;
    const t = (ech[i - 1].t + ech[i].t) / 2;
    out.push(coupes.find((c) => c >= ech[i - 1].t - 0.05 && c <= ech[i].t + 0.05) ?? t);
  }
  return out;
}

/** Une personne (ou un animal) vue sur une image. `x` : où la suivre (sa tête si on la voit, sinon son corps). */
type Vue = { t: number; x: number; tete?: { x: number; y: number; h: number }; corps: { x: number; y: number; w: number; h: number }; taille: number; geste: number; bouche: number };

/** Les personnes d'une image : chaque visage est rattaché au corps qui le porte ; un visage sans corps détecté (gros
 *  plan) devient une personne à part entière. */
function vuesDe(e: Echantillon): Vue[] {
  const corps = (e.c ?? []).filter((c) => c[4] >= 0.35 && c[3] >= 0.08);
  const libres = new Set(corps.map((_, i) => i));
  const out: Vue[] = [];
  for (const [x, y, w, h, conf, bouche = 0] of e.f) {
    if (conf < 0.5 || w < 0.012) continue;
    // Le corps qui contient ce visage dans son haut ; le plus petit, s'il y en a plusieurs.
    const i = [...libres].filter((j) => { const c = corps[j]; return Math.abs(x - c[0]) < c[2] / 2 && y > c[1] - c[3] / 2 - h && y < c[1] - c[3] / 2 + c[3] * 0.5; })
      .sort((p, q) => corps[p][2] * corps[p][3] - corps[q][2] * corps[q][3])[0];
    const c = i !== undefined ? corps[i] : undefined;
    if (i !== undefined) libres.delete(i);
    const k = c ? { x: c[0], y: c[1], w: c[2], h: c[3] } : { x, y: Math.min(1, y + h * 2), w: Math.min(1, w * 3), h: Math.min(1, h * 5) };
    out.push({ t: e.t, x, tete: { x, y, h }, corps: k, taille: Math.min(1, Math.max(k.h, h * 4)), geste: c?.[6] ?? 0, bouche });
  }
  for (const i of libres) {
    const c = corps[i];
    out.push({ t: e.t, x: c[0], corps: { x: c[0], y: c[1], w: c[2], h: c[3] }, taille: c[3], geste: c[6] ?? 0, bouche: 0 });
  }
  return out;
}

/** Une personne suivie pendant un plan. */
type Piste = { vues: Vue[]; taille: number; presence: number };

/** Suit les personnes d'une image à l'autre : même place, taille proche. */
function pistes(ech: Echantillon[]): Piste[] {
  const ps: Piste[] = [];
  for (const e of ech) {
    const prises = new Set<Piste>();
    for (const v of vuesDe(e).sort((a, b) => b.taille - a.taille)) {
      const p = ps.filter((q) => !prises.has(q)).map((q) => ({ q, d: Math.abs(q.vues.at(-1)!.x - v.x), r: q.vues.at(-1)!.taille / v.taille, dt: v.t - q.vues.at(-1)!.t }))
        .filter((o) => o.dt < 1 && o.d < Math.max(0.1, v.corps.w * 0.6) && o.r > 0.55 && o.r < 1.8).sort((a, b) => a.d - b.d)[0]?.q;
      if (p) { p.vues.push(v); prises.add(p); } else { const n = { vues: [v], taille: 0, presence: 0 }; ps.push(n); prises.add(n); }
    }
  }
  for (const p of ps) { p.taille = mediane(p.vues.map((v) => v.taille)); p.presence = p.vues.length / Math.max(1, ech.length); }
  return ps;
}

/** Les positions du cadre sur une personne pendant [a, b] : fixe si elle bouge peu, sinon il la suit en douceur. */
function cadrer(p: Piste, a: number, b: number, mode: "tete" | "corps"): Cle[] {
  const vues = p.vues.filter((v) => v.t >= a - 0.2 && v.t <= b + 0.2);
  // Plan corps : le milieu du corps, sans que la tête s'éloigne du centre (le cadre couvre un tiers de la largeur).
  const pos = (v: Vue) => mode === "tete" && v.tete ? { x: v.tete.x, y: v.tete.y }
    : { x: v.tete ? Math.min(v.tete.x + 0.09, Math.max(v.tete.x - 0.09, v.corps.x)) : v.corps.x, y: 0.5 };
  const xs = vues.map((v) => pos(v).x), ys = vues.map((v) => pos(v).y);
  if (!vues.length) return [{ t: a, x: 0.5, y: 0.5, x2: 0.5, y2: 0.5 }];
  if (Math.max(...xs) - Math.min(...xs) < 0.06 && Math.max(...ys) - Math.min(...ys) < 0.06) {
    const x = mediane(xs), y = mediane(ys);
    return [{ t: a, x, y, x2: x, y2: y }];
  }
  const out: Cle[] = [];
  for (let t = a; t < b; t += 0.5) {
    const proches = vues.filter((v) => Math.abs(v.t - t) <= 0.5);
    if (proches.length) { const x = mediane(proches.map((v) => pos(v).x)), y = mediane(proches.map((v) => pos(v).y)); out.push({ t, x, y, x2: x, y2: y }); }
  }
  if (out.length) out[0].t = a;
  return out.length ? out : [{ t: a, x: mediane(xs), y: mediane(ys), x2: mediane(xs), y2: mediane(ys) }];
}

/** Le plan d'une personne pendant [a, b] : la tête si elle parle sans bouger et qu'on voit son visage d'assez loin
 *  pour zoomer ; sinon le corps entier. */
function planDe(p: Piste, a: number, b: number): Morceau {
  const vues = p.vues.filter((v) => v.t >= a && v.t <= b);
  const tetes = vues.filter((v) => v.tete);
  const geste = moyenne(vues.map((v) => v.geste));
  // Zoomer sur une tête déjà grande ferait un plan trop serré (et flou) : le plan corps la cadre déjà de près.
  const mode = tetes.length >= vues.length * 0.5 && geste < GESTE && mediane(tetes.map((v) => v.tete!.h)) < 0.2 ? "tete" : "corps";
  return { a, b, mode, cles: cadrer(p, a, b, mode) };
}

/** Un grand geste : le corps bouge nettement d'une image à l'autre (mesuré sur ~70 ms). */
const GESTE = 0.025;

/** Les morceaux du passage (durée `len`). Tout est en secondes depuis le début du passage : `coupes`, les vrais
 *  changements de plan ; `phrases`, les débuts de phrase ; `vu`, ce que voit et entend le détecteur. */
export function morceaux(plans: Plan[], len: number, coupes: number[], phrases: number[], vu: Echantillon[]): Morceau[] {
  const vues = [...coupes, ...coupesVisages(vu, coupes)].sort((a, b) => a - b).filter((c, i, l) => i === 0 || c - l[i - 1] > 0.3);
  const bords = [0, ...vues.filter((c) => c > 0.3 && c < len - 0.3), len];
  // Une voix : nettement au-dessus du bruit de fond habituel du passage.
  const sons = vu.map((e) => e.voix ?? 0).filter((v) => v > 0);
  const seuilVoix = sons.length ? mediane(sons) * 0.5 : 0;
  const out: Morceau[] = [];
  for (let i = 0; i < bords.length - 1; i++) {
    const a = bords[i], b = bords[i + 1];
    if (b - a < 0.05) continue;
    for (const m of plan(a, b)) {
      const prev = out.at(-1);
      // Un plan de la caméra minuscule (un flash de montage) garde le cadre du précédent.
      if (prev && m.b - m.a < 0.3) prev.b = m.b; else out.push(m);
    }
  }
  if (out.length > 1 && out[0].b - out[0].a < 0.3) { out[1].a = 0; out[1].cles[0].t = 0; out.shift(); }
  return out.map((m) => ({ ...m, a: round(m.a), b: round(m.b), cles: m.cles.map((k) => ({ t: round(k.t), x: round(k.x, 1000), y: round(k.y, 1000), x2: round(k.x2, 1000), y2: round(k.y2, 1000) })) }));

  /** Un plan de la caméra [a, b] : qui prend le cadre, et quand ça change. */
  function plan(a: number, b: number): Morceau[] {
    const ech = vu.filter((e) => e.t >= a && e.t < b);
    const ps = pistes(ech);
    const grand = Math.max(0, ...ps.filter((p) => p.presence >= 0.3).map((p) => p.taille));
    // Ceux qui comptent : présents la plupart du temps, et pas le public du fond (bien plus petit que les principaux).
    const actifs = ps.filter((p) => p.presence >= 0.3 && p.taille >= grand * 0.5);
    const g = plans.filter((p) => p.t <= (a + b) / 2 + 0.5).at(-1);
    if (!actifs.length) {
      // Personne de détecté : Gemini voit quand même quelqu'un (de dos, très loin) ? On cadre là où il le dit.
      if (g?.mode === "un") return [{ a, b, mode: "corps", cles: [{ t: a, x: g.x, y: 0.5, x2: g.x, y2: 0.5 }] }];
      if (g?.mode === "duo") return [{ a, b, mode: "duo", cles: [{ t: a, x: Math.min(g.x, g.x2!), y: 0.4, x2: Math.max(g.x, g.x2!), y2: 0.4 }] }];
      return [{ a, b, mode: "flou", cles: [{ t: a, x: 0.5, y: 0.5, x2: 0.5, y2: 0.5 }] }];
    }
    // La note de chaque personne, toutes les demi-secondes : parle (sa bouche bouge pendant qu'on entend une voix),
    // fait de grands gestes, est près de la caméra. Absente de l'image : elle ne peut pas avoir le cadre.
    const fen: number[] = [];
    for (let t = a; t < b - 0.05; t += 0.5) fen.push(t);
    const mesures = fen.map((t) => {
      const voix = moyenne(ech.filter((e) => e.t >= t && e.t < t + 0.5).map((e) => e.voix ?? 0)) > seuilVoix;
      return actifs.map((p) => {
        const v = p.vues.filter((x) => x.t >= t && x.t < t + 0.5);
        return v.length ? { parle: moyenne(v.map((x) => x.bouche)) * (voix ? 1 : 0.2), geste: moyenne(v.map((x) => x.geste)) } : null;
      });
    });
    const maxParle = Math.max(0, ...mesures.flat().map((m) => m?.parle ?? 0));
    // Gemini ne sert qu'à départager : un petit bonus à la personne qu'il désigne vraiment (pas « au milieu »).
    const designe = (t: number) => { const p = plans.filter((x) => x.t <= t + 0.25).at(-1); return p?.mode === "un" && Math.abs(p.x - 0.5) > 0.1 ? p.x : null; };
    const notes = mesures.map((ms, k) => ms.map((m, j) => {
      if (!m) return -Infinity;
      const d = designe(fen[k]), p = actifs[j];
      return (maxParle > 0.004 ? 3 * m.parle / maxParle : 0) + 2 * Math.min(1, m.geste / (GESTE * 1.6)) + p.taille / grand
        + (d !== null && Math.abs(p.vues[0].x - d) < 0.12 ? 0.7 : 0);
    }));
    // Qui a le cadre : la meilleure note, mais on ne change qu'après 1,5 s d'avance (pas de ping-pong), au début de la
    // phrase la plus proche.
    const meilleur = notes.map((ns) => ns.indexOf(Math.max(...ns)));
    const tours: { t: number; j: number }[] = [{ t: a, j: meilleur[0] }];
    for (let k = 1; k < meilleur.length; k++) {
      const j = meilleur[k], cur = tours.at(-1)!.j;
      if (j === cur) continue;
      // 1,5 s d'avance, ou la personne qui avait le cadre a quitté l'image depuis 1 s.
      const suite = meilleur.slice(k, k + 3);
      const tient = (suite.length === 3 && suite.every((x) => x === j)) || (notes[k][cur] === -Infinity && notes[k + 1]?.[cur] === -Infinity);
      if (!tient) continue;
      const t0 = fen[k];
      const t = phrases.filter((p) => Math.abs(p - t0) <= 0.8 && p > tours.at(-1)!.t + 1 && p < b - 0.5).sort((p, q) => Math.abs(p - t0) - Math.abs(q - t0))[0] ?? t0;
      tours.push({ t, j });
    }
    // Deux personnes éloignées qui se répondent très vite (au moins 3 tours de moins de 3 s) : écran coupé.
    const ms: Morceau[] = [];
    for (let k = 0; k < tours.length; k++) {
      const s = tours[k].t, e = tours[k + 1]?.t ?? b;
      const prev = ms.at(-1);
      const p = actifs[tours[k].j];
      if (prev && prev.mode !== "duo" && k >= 2 && e - s < 3 && tours[k - 2].j === tours[k].j && tours[k - 1].t - tours[k - 2].t < 3) {
        const q = actifs[tours[k - 1].j];
        if (Math.abs(p.vues[0].x - q.vues[0].x) >= 0.3) {
          const [h, bas] = [p, q].sort((u, w) => mediane(u.vues.map((v) => v.x)) - mediane(w.vues.map((v) => v.x)));
          const hy = mediane(h.vues.filter((v) => v.tete).map((v) => v.tete!.y)) || 0.4, by = mediane(bas.vues.filter((v) => v.tete).map((v) => v.tete!.y)) || 0.4;
          // Les deux derniers tours deviennent un seul écran coupé.
          ms.pop();
          const debut = ms.at(-1)?.b ?? tours[k - 1].t;
          ms.push({ a: debut, b: e, mode: "duo", cles: [{ t: debut, x: mediane(h.vues.map((v) => v.x)), y: hy, x2: mediane(bas.vues.map((v) => v.x)), y2: by }] });
          continue;
        }
      }
      if (prev?.mode === "duo" && e - s < 3 && prev.b === s) { prev.b = e; continue; }
      ms.push(planDe(p, s, e));
    }
    return ms;
  }
}

/** Une valeur qui change avec le temps, en expression FFmpeg évaluée à chaque image (t = temps du Short) : fixe dans un
 *  morceau, ou qui glisse d'une position à la suivante quand le cadre suit quelqu'un. */
function selon(ms: Morceau[], v: (k: Cle) => number): string {
  const bouts: { a: number; b: number; va: number; vb: number }[] = [];
  for (const m of ms) {
    m.cles.forEach((k, i) => {
      const s = m.cles[i + 1];
      bouts.push({ a: k.t, b: s ? s.t : m.b, va: v(k), vb: s ? v(s) : v(k) });
    });
  }
  const f = (n: number) => n.toFixed(3);
  const val = (o: (typeof bouts)[0]) => (Math.abs(o.vb - o.va) < 0.002 ? f(o.va) : `${f(o.va)}+${f(o.vb - o.va)}*(t-${o.a})/${round(o.b - o.a)}`);
  // Une somme à plat (« pendant ce bout, cette valeur » + …) : FFmpeg refuse les « si » imbriqués trop profondément.
  // Le premier et le dernier bout s'étendent au-delà, pour couvrir chaque image.
  return bouts.map((o, i) => `gte(t\\,${i ? o.a : -1e6})*lt(t\\,${i < bouts.length - 1 ? o.b : 1e6})*(${val(o)})`).join("+");
}
/** Vrai (1) pendant les morceaux d'un mode, en expression FFmpeg. */
const pendantMode = (ms: Morceau[], mode: Morceau["mode"]) => ms.filter((m) => m.mode === mode).map((m) => `between(t\\,${m.a}\\,${round(m.b - 0.001, 1000)})`).join("+") || "0";

/** Le filtre FFmpeg du montage auto, sortie 1080×1920. Les quatre mises en page sont calculées en continu (rien
 *  n'est gardé en mémoire) et on affiche, à chaque image, celle du morceau en cours. */
export function filtreMontage(ms: Morceau[]): string {
  // La personne au centre du cadre, sans sortir de l'image : x = sa position × largeur − la moitié du cadre.
  const centre = (e: string) => `max(0\\,min(iw-ow\\,(${e})*iw-ow/2))`;
  // Le visage placé à une hauteur donnée du cadre (`haut` : 0,36 = un peu au-dessus du tiers).
  const hauteur = (e: string, haut: number) => `max(0\\,min(ih-oh\\,(${e})*ih-oh*${haut}))`;
  const x = selon(ms, (k) => k.x), y = selon(ms, (k) => k.y);
  // Duo : chaque moitié (1080×960) zoome sur une personne, son visage un peu au-dessus du milieu.
  const moitie = (cx: string, cy: string, nom: string) => `crop=w=ih*0.62*9/8:h=ih*0.62:x=${centre(cx)}:y=${hauteur(cy, 0.42)},scale=1080:960,setsar=1[${nom}]`;
  return [
    "[0:v]fps=30,split=6[s0][s1][s2][s3][s4][s5]",
    "[s0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:2,eq=brightness=-0.12[fond]",
    "[s1]scale=1080:-2[milieu]",
    "[fond][milieu]overlay=(W-w)/2:(H-h)/2,setsar=1[flou]",
    `[s2]crop=w=min(iw\\,ih*9/16):h=ih:x=${centre(x)},scale=1080:1920,setsar=1[corps]`,
    // Plan tête : deux tiers de la hauteur de l'image, le visage au tiers du cadre.
    `[s3]crop=w=ih*0.66*9/16:h=ih*0.66:x=${centre(x)}:y=${hauteur(y, 0.36)},scale=1080:1920,setsar=1[tete]`,
    `[s4]${moitie(x, y, "haut")}`,
    `[s5]${moitie(selon(ms, (k) => k.x2), selon(ms, (k) => k.y2), "bas")}`,
    "[haut][bas]vstack[duo]",
    `[flou][corps]overlay=enable=${pendantMode(ms, "corps")}[t1]`,
    `[t1][tete]overlay=enable=${pendantMode(ms, "tete")}[t2]`,
    `[t2][duo]overlay=enable=${pendantMode(ms, "duo")},setsar=1[vout]`,
  ].join(";");
}
