// Montage auto (2.0) : au lieu d'un seul cadrage pour tout le Short, le cadre change d'un plan à l'autre et suit les
// visages, comme un monteur. Trois sources :
// - FFmpeg trouve les vrais changements de plan, à l'image près ;
// - le détecteur de visages (scripts/visages.py) dit où sont les visages, 5 fois par seconde ;
// - Gemini (ai/montage-ia.ts) dit qui suivre : la personne qui parle, ou la principale dans un plan de groupe, et
//   quand faire un écran coupé. Sa position n'est qu'indicative : on cadre sur le visage détecté le plus proche.
// Chaque morceau est monté ainsi :
// - « un » : plein écran vertical, le visage au milieu (il suit la personne si elle bouge) ;
// - « duo » : écran coupé, une personne en haut, l'autre en bas (deux personnes importantes trop éloignées pour un
//   seul cadre vertical, même dans un plan large) ;
// - « flou » : personne du tout à l'écran (texte, animation) : l'image entière sur un fond flouté.

export type Mode = "un" | "duo" | "rien";
/** Un changement noté par Gemini : à partir de `t` (secondes depuis le début du passage), le cadre suit `x` (0 à
 *  gauche, 1 à droite) ; en duo, `x` va en haut et `x2` en bas. */
export type Plan = { t: number; mode: Mode; x: number; x2?: number };
/** Les visages vus à `t` (secondes depuis le début du passage) : [centre x, centre y, largeur, hauteur, confiance], entre 0 et 1. */
export type Echantillon = { t: number; f: number[][] };
/** Une position du cadre à un instant ; entre deux positions d'un même morceau, le cadre glisse. */
export type Cle = { t: number; x: number; y: number; x2: number; y2: number };
/** Un morceau du Short, en secondes depuis le début du Short. */
export type Morceau = { a: number; b: number; mode: "un" | "duo" | "flou"; cles: Cle[] };

const borne = (x: unknown, def = 0.5) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : def);
const round = (n: number, p = 100) => Math.round(n * p) / p;
const mediane = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

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

/** Une personne suivie pendant un morceau : son visage, image par image. */
type Piste = { cx: number; taille: number; pts: { t: number; x: number; y: number; h: number }[] };

/** Regroupe les visages d'un morceau en personnes (même place dans l'image d'une image à l'autre). */
function pistes(ech: Echantillon[]): Piste[] {
  const ps: Piste[] = [];
  for (const e of ech) {
    for (const [x, y, w, h, conf] of e.f) {
      if ((conf ?? 1) < 0.6 || w < 0.02) continue;
      const p = ps.find((q) => Math.abs(q.pts.at(-1)!.x - x) < Math.max(0.08, w));
      if (p) p.pts.push({ t: e.t, x, y, h }); else ps.push({ cx: x, taille: w, pts: [{ t: e.t, x, y, h }] });
    }
  }
  for (const p of ps) { p.cx = mediane(p.pts.map((q) => q.x)); p.taille = mediane(p.pts.map((q) => q.h)); }
  // Une personne qui n'apparaît que sur quelques images (fausse détection, quelqu'un qui passe) ne compte pas.
  return ps.filter((p) => p.pts.length >= Math.max(2, ech.length * 0.3));
}

/** Les positions du cadre sur une piste : fixe si la personne bouge peu, sinon il la suit en douceur (2 fois par seconde). */
function suivre(p: Piste, a: number, b: number): { t: number; x: number; y: number }[] {
  const xs = p.pts.map((q) => q.x);
  const y = mediane(p.pts.map((q) => q.y));
  if (Math.max(...xs) - Math.min(...xs) < 0.08) return [{ t: a, x: p.cx, y }];
  const out: { t: number; x: number; y: number }[] = [];
  for (let t = a; t < b; t += 0.5) {
    const proches = p.pts.filter((q) => Math.abs(q.t - t) <= 0.5);
    if (proches.length) out.push({ t, x: mediane(proches.map((q) => q.x)), y });
  }
  if (out.length) out[0].t = a;
  return out.length ? out : [{ t: a, x: p.cx, y }];
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

/** Les morceaux du passage (durée `len`). Tout est en secondes depuis le début du passage : `coupes`, les vrais
 *  changements de plan ; `phrases`, les débuts de phrase ; `visages`, ce que voit le détecteur. */
export function morceaux(plans: Plan[], len: number, coupes: number[], phrases: number[], visages: Echantillon[]): Morceau[] {
  // 1) Les plans de la caméra, puis, dans un plan, les changements de personne notés par Gemini (recalés sur le début
  //    de phrase le plus proche : c'est quand l'autre répond).
  const vues = [...coupes, ...coupesVisages(visages, coupes)].sort((a, b) => a - b).filter((c, i, l) => i === 0 || c - l[i - 1] > 0.3);
  const bords = [0, ...vues.filter((c) => c > 0.3 && c < len - 0.3), len];
  for (const p of plans) {
    if (p.t <= 0.3 || p.t >= len - 0.3) continue;
    const t = phrases.filter((f) => Math.abs(f - p.t) <= 1.5).sort((f, g) => Math.abs(f - p.t) - Math.abs(g - p.t))[0] ?? p.t;
    // Gemini en retard (ou en avance) sur un changement de plan : c'est ce changement-là, pas un nouveau morceau.
    if (bords.every((c) => Math.abs(c - t) > 1.2)) bords.push(t);
  }
  bords.sort((a, b) => a - b);

  const out: Morceau[] = [];
  for (let i = 0; i < bords.length - 1; i++) {
    const a = bords[i], b = bords[i + 1];
    if (b - a < 0.05) continue;
    const milieu = (a + b) / 2;
    // Qui Gemini veut suivre : la note en cours au milieu du morceau.
    const g = plans.filter((p) => p.t <= milieu + 0.5).at(-1) ?? plans[0];
    const ps = pistes(visages.filter((e) => e.t >= a && e.t <= b));
    const proche = (x: number) => [...ps].sort((p, q) => Math.abs(p.cx - x) - Math.abs(q.cx - x))[0];
    let m: Morceau;
    const fixe = (mode: Morceau["mode"], x: number, y: number, x2 = x, y2 = y): Morceau => ({ a, b, mode, cles: [{ t: a, x, y, x2, y2 }] });
    const yDe = (p: Piste) => mediane(p.pts.map((q) => q.y));
    // Les personnes qui comptent : les plus grands visages (les plus près de la caméra), pas le public au fond.
    const grand = Math.max(0, ...ps.map((p) => p.taille));
    const importants = ps.filter((p) => p.taille >= grand * 0.6).sort((p, q) => q.taille - p.taille);
    // Deux personnes trop éloignées pour tenir ensemble dans un cadre vertical (il couvre un tiers de la largeur).
    const loin = importants.find((p) => Math.abs(p.cx - importants[0]?.cx) >= 0.3);
    // Gemini a vraiment désigné quelqu'un (il met souvent 0,5 par défaut) : la personne détectée à cet endroit.
    const designe = g?.mode === "un" && Math.abs(g.x - 0.5) > 0.1 ? ps.find((p) => Math.abs(p.cx - g.x) < 0.1) : undefined;
    if (!ps.length) {
      // Aucun visage détecté (profil, dos, de loin) : Gemini voit quand même quelqu'un ? On cadre là où il le dit.
      // Personne du tout (texte, animation) : l'image entière sur fond flouté.
      m = g?.mode === "un" ? fixe("un", g.x, 0.4) : g?.mode === "duo" ? fixe("duo", Math.min(g.x, g.x2!), 0.4, Math.max(g.x, g.x2!), 0.4) : fixe("flou", 0.5, 0.5);
    } else if (g?.mode === "duo" && ps.length >= 2 && !designe) {
      const h = proche(g.x), bas = proche(g.x2 ?? g.x) === h ? ps.find((p) => p !== h)! : proche(g.x2 ?? g.x);
      m = fixe("duo", h.cx, yDe(h), bas.cx, yDe(bas));
    } else if (loin && !designe) {
      // Deux personnes importantes éloignées (face à face, ou un plan large) : écran coupé, celle de gauche en haut.
      const [h, bas] = [importants[0], loin].sort((p, q) => p.cx - q.cx);
      m = fixe("duo", h.cx, yDe(h), bas.cx, yDe(bas));
    } else {
      // Une seule personne qui compte (ou celle que Gemini désigne) : plein écran sur elle, en la suivant.
      const p = designe ?? importants[0];
      m = { a, b, mode: "un", cles: suivre(p, a, b).map((k) => ({ ...k, x2: k.x, y2: k.y })) };
    }
    const prev = out.at(-1);
    // Dans un même plan, un morceau de moins de 0,8 s ferait un flash : il garde le cadre du précédent. Après un vrai
    // changement de plan, l'image saute de toute façon : le morceau garde son cadre, même court.
    const coupe = vues.some((c) => Math.abs(c - a) < 0.01);
    if (prev && ((b - a < 0.8 && !coupe) || (!coupe && prev.mode === m.mode && prev.cles.length === 1 && m.cles.length === 1 && Math.abs(prev.cles[0].x - m.cles[0].x) < 0.03 && Math.abs(prev.cles[0].x2 - m.cles[0].x2) < 0.03))) prev.b = b;
    else out.push(m);
  }
  if (out.length > 1 && out[0].b - out[0].a < 0.3) { out[1].a = 0; out[1].cles[0].t = 0; out.shift(); }
  return out.map((m) => ({ ...m, a: round(m.a), b: round(m.b), cles: m.cles.map((k) => ({ t: round(k.t), x: round(k.x, 1000), y: round(k.y, 1000), x2: round(k.x2, 1000), y2: round(k.y2, 1000) })) }));
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
  return bouts.slice(0, -1).reduceRight((suite, o) => `if(lt(t\\,${o.b})\\,${val(o)}\\,${suite})`, val(bouts.at(-1)!));
}
/** Vrai (1) pendant les morceaux d'un mode, en expression FFmpeg. */
const pendantMode = (ms: Morceau[], mode: Morceau["mode"]) => ms.filter((m) => m.mode === mode).map((m) => `between(t\\,${m.a}\\,${round(m.b - 0.001, 1000)})`).join("+") || "0";

/** Le filtre FFmpeg du montage auto, sortie 1080×1920. Les trois mises en page sont calculées en continu (rien n'est
 *  gardé en mémoire) et on affiche, à chaque image, celle du morceau en cours. */
export function filtreMontage(ms: Morceau[]): string {
  // Le visage au centre du cadre, sans sortir de l'image : x = position du visage × largeur − la moitié du cadre.
  const centre = (e: string) => `max(0\\,min(iw-ow\\,(${e})*iw-ow/2))`;
  const hauteur = (e: string) => `max(0\\,min(ih-oh\\,(${e})*ih-oh*0.42))`;
  // Duo : chaque moitié (1080×960) zoome sur une personne, son visage un peu au-dessus du milieu.
  const moitie = (cx: string, cy: string, nom: string) => `crop=w=ih*0.62*9/8:h=ih*0.62:x=${centre(cx)}:y=${hauteur(cy)},scale=1080:960,setsar=1[${nom}]`;
  return [
    "[0:v]fps=30,split=5[s0][s1][s2][s3][s4]",
    "[s0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:2,eq=brightness=-0.12[fond]",
    "[s1]scale=1080:-2[milieu]",
    "[fond][milieu]overlay=(W-w)/2:(H-h)/2,setsar=1[flou]",
    `[s2]crop=w=min(iw\\,ih*9/16):h=ih:x=${centre(selon(ms, (k) => k.x))},scale=1080:1920,setsar=1[un]`,
    `[s3]${moitie(selon(ms, (k) => k.x), selon(ms, (k) => k.y), "haut")}`,
    `[s4]${moitie(selon(ms, (k) => k.x2), selon(ms, (k) => k.y2), "bas")}`,
    "[haut][bas]vstack[duo]",
    `[flou][un]overlay=enable=${pendantMode(ms, "un")}[t1]`,
    `[t1][duo]overlay=enable=${pendantMode(ms, "duo")},setsar=1[vout]`,
  ].join(";");
}
