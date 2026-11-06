// Montage auto : l'image horizontale est découpée en zones fixes, et le Short passe d'une zone à l'autre selon qui
// parle, comme un monteur qui change de caméra :
// - « centre » : la bande verticale du milieu (format TikTok) ;
// - « gauche » / « droite » : la moitié gauche ou droite de l'image, cadrée en vertical ;
// - « duo » : la moitié gauche en haut et la moitié droite en bas, quand les deux côtés parlent.
// Le cadre ne bouge jamais à l'intérieur d'une zone : il ne fait que changer de zone, net, au début d'une phrase ou à
// un changement de plan de la caméra.
// Qui parle : scripts/personnes.py mesure, pour chaque visage, le mouvement de la bouche pendant qu'on entend une voix.

export type Mode = "un" | "duo" | "rien";
/** Un changement noté par Gemini : à partir de `t` (secondes depuis le début du passage), le cadre suit `x` (0 à
 *  gauche, 1 à droite) ; en duo, `x` va en haut et `x2` en bas. */
export type Plan = { t: number; mode: Mode; x: number; x2?: number };
/** Ce qu'on voit et entend à `t` (secondes depuis le début du passage), positions et tailles entre 0 et 1.
 *  `f` : les visages [centre x, centre y, largeur, hauteur, confiance, bouche] ; `c` : les corps ; `voix` : le volume. */
export type Echantillon = { t: number; f: number[][]; c?: number[][]; voix?: number };
export type Zone = "gauche" | "centre" | "droite" | "duo";
/** Un morceau du Short, en secondes depuis le début du Short. */
export type Morceau = { a: number; b: number; mode: Zone };

const borne = (x: unknown, def = 0.5) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : def);
const round = (n: number, p = 100) => Math.round(n * p) / p;
const mediane = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const moyenne = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

/** La zone dont le milieu est le plus proche du visage. */
const coteDe = (x: number): "gauche" | "centre" | "droite" => (x < 0.375 ? "gauche" : x > 0.625 ? "droite" : "centre");
/** Images par seconde du Short (le filtre FFmpeg commence par fps=30). */
const IPS = 30;
/** Le centre de chaque zone plein écran, dans la largeur de l'image. */
export const CENTRES = { gauche: 0.25, centre: 0.5, droite: 0.75 } as const;

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

/** Les morceaux du passage (durée `len`). Tout est en secondes depuis le début du passage : `coupes`, les vrais
 *  changements de plan ; `phrases`, les débuts de phrase ; `vu`, ce que voit et entend le détecteur ; `fines`, toutes
 *  les images qui changent un peu (pour caler à l'image près les changements de plan vus aux visages). */
export function morceaux(plans: Plan[], len: number, coupes: number[], phrases: number[], vu: Echantillon[], fines: number[] = coupes): Morceau[] {
  const vues = [...coupes, ...coupesVisages(vu, fines)].sort((a, b) => a - b).filter((c, i, l) => i === 0 || c - l[i - 1] > 0.3);
  const bords = [0, ...vues.filter((c) => c > 0.3 && c < len - 0.3), len];
  // Une voix : nettement au-dessus du bruit de fond habituel du passage.
  const sons = vu.map((e) => e.voix ?? 0).filter((v) => v > 0);
  const seuilVoix = sons.length ? mediane(sons) * 0.5 : 0;
  const out: Morceau[] = [];
  for (let i = 0; i < bords.length - 1; i++) {
    if (bords[i + 1] - bords[i] < 0.05) continue;
    for (const m of plan(bords[i], bords[i + 1])) {
      const prev = out.at(-1);
      // Même zone que juste avant, ou un plan minuscule (un flash de montage) : on prolonge.
      if (prev && (prev.mode === m.mode || m.b - m.a < 0.3)) prev.b = m.b; else out.push(m);
    }
  }
  // Chaque changement est calé sur la grille du Short (30 images/s) : la première image qui montre le nouveau plan
  // (FFmpeg prend l'image source la plus proche), moins une demi-image. Sinon, une image du nouveau plan s'afficherait
  // dans l'ancienne zone (ou l'inverse) : un flash.
  const avant = (t: number) => Math.round((Math.round(t * IPS) - 0.5) / IPS * 1000) / 1000;
  return out.map((m, i) => ({ ...m, a: i ? avant(m.a) : 0, b: i < out.length - 1 ? avant(m.b) : round(m.b) }));

  /** Un plan de la caméra [a, b] : quelle zone, et quand ça change. */
  function plan(a: number, b: number): Morceau[] {
    const ech = vu.filter((e) => e.t >= a && e.t < b);
    const visages = (e: Echantillon) => e.f.filter((f) => f[4] >= 0.5 && f[2] >= 0.012);
    // Les côtés où il y a quelqu'un d'important (pas le public du fond : un visage bien plus petit que les autres).
    const grand = Math.max(0, ...ech.flatMap((e) => visages(e).map((f) => f[3])));
    const presents = new Set(ech.flatMap((e) => visages(e).filter((f) => f[3] >= grand * 0.5).map((f) => coteDe(f[0]))));
    // Aucun visage (de profil, de dos, trop loin) : le côté du plus grand corps, présent au moins un tiers du plan.
    if (!presents.size) {
      const corps = ech.flatMap((e) => (e.c ?? []).filter((c) => c[4] >= 0.35 && c[5] === 0));
      const haut = Math.max(0, ...corps.map((c) => c[3]));
      const parCote = new Map<string, number>();
      for (const c of corps.filter((c) => c[3] >= haut * 0.7)) parCote.set(coteDe(c[0]), (parCote.get(coteDe(c[0])) ?? 0) + 1);
      const [cote, n] = [...parCote].sort((p, q) => q[1] - p[1])[0] ?? [];
      if (cote && n >= ech.length / 3) presents.add(cote as "gauche" | "centre" | "droite");
    }
    // Personne ne parle clairement : la zone où sont les gens (les deux côtés : haut et bas), sinon le centre.
    const parDefaut: Zone = presents.size === 1 ? [...presents][0] : presents.has("gauche") && presents.has("droite") ? "duo" : "centre";
    // Toutes les demi-secondes : qui parle, de quel côté.
    const fen: { t: number; zone: Zone | null }[] = [];
    const parle: Record<string, number>[] = [];
    for (let t = a; t < b - 0.05; t += 0.5) {
      const dans = ech.filter((e) => e.t >= t && e.t < t + 0.5);
      const voix = moyenne(dans.map((e) => e.voix ?? 0)) > seuilVoix;
      const p: Record<string, number> = { gauche: 0, centre: 0, droite: 0 };
      if (voix) for (const e of dans) for (const f of visages(e)) if (f[3] >= grand * 0.5) p[coteDe(f[0])] += (f[5] ?? 0) / dans.length;
      parle.push(p);
      fen.push({ t, zone: null });
    }
    const max = Math.max(0, ...parle.flatMap((p) => Object.values(p)));
    parle.forEach((p, k) => {
      const meilleur = Math.max(...Object.values(p));
      if (meilleur < Math.max(0.004, max * 0.35)) {
        // Personne ne parle et une seule personne à l'image : la zone suit le côté où elle est (si elle se déplace).
        const dans = ech.filter((e) => e.t >= fen[k].t && e.t < fen[k].t + 0.5);
        const cotes = new Set(dans.flatMap((e) => visages(e).filter((f) => f[3] >= grand * 0.5).map((f) => coteDe(f[0]))));
        if (cotes.size === 1 && dans.every((e) => visages(e).filter((f) => f[3] >= grand * 0.5).length <= 1)) fen[k].zone = [...cotes][0];
        return;
      }
      const actifs = (Object.keys(p) as ("gauche" | "centre" | "droite")[]).filter((z) => p[z] >= meilleur * 0.5);
      fen[k].zone = actifs.includes("gauche") && actifs.includes("droite") ? "duo" : actifs.sort((x, y) => p[y] - p[x])[0];
    });
    // On ne change de zone qu'après 1,5 s (pas de ping-pong), au début de la phrase la plus proche.
    const premier = fen.find((f) => f.zone)?.zone ?? parDefaut;
    const tours: Morceau[] = [{ a, b, mode: premier }];
    for (let k = 1; k < fen.length; k++) {
      const z = fen[k].zone, cur = tours.at(-1)!;
      if (!z || z === cur.mode) continue;
      const suite = fen.slice(k, k + 3);
      if (suite.length < 3 || !suite.every((f) => f.zone === z || f.zone === null) || suite.filter((f) => f.zone === z).length < 2) continue;
      const t0 = fen[k].t;
      // Le premier choix du plan est contredit dès la première seconde : c'était le mauvais, on le corrige.
      if (tours.length === 1 && t0 - a < 1.2) { cur.mode = z; continue; }
      const t = phrases.filter((p) => Math.abs(p - t0) <= 0.8 && p > cur.a + 1 && p < b - 0.5).sort((p, q) => Math.abs(p - t0) - Math.abs(q - t0))[0] ?? t0;
      cur.b = t;
      tours.push({ a: t, b, mode: z });
    }
    // Gauche et droite qui se répondent très vite (moins de 3 s chacun) : les deux en même temps, en haut et en bas.
    for (let k = 1; k < tours.length - 1; k++) {
      const [p, c, n] = [tours[k - 1], tours[k], tours[k + 1]];
      const echange = new Set([p.mode, c.mode, n.mode]);
      if (c.b - c.a < 3 && p.mode === n.mode && echange.has("gauche") && echange.has("droite")) { p.mode = "duo"; c.mode = "duo"; n.mode = "duo"; }
    }
    // Personne de détecté de tout le plan : Gemini voit peut-être quelqu'un sur un côté.
    const g = plans.filter((x) => x.t <= (a + b) / 2 + 0.5).at(-1);
    if (!presents.size && g?.mode === "un") return [{ a, b, mode: coteDe(g.x) }];
    return tours;
  }
}

/** Le filtre FFmpeg du montage auto, sortie 1080×1920. Deux mises en page calculées en continu (rien n'est gardé en
 *  mémoire) : plein écran (sa position change selon la zone) et haut/bas ; on affiche celle du morceau en cours. */
export function filtreMontage(ms: Morceau[]): string {
  // Plein écran : la bande verticale centrée sur la zone, sans sortir de l'image. Une somme à plat (« pendant ce
  // morceau, cette position » + …) : FFmpeg refuse les « si » imbriqués trop profondément.
  const x = ms.filter((m) => m.mode !== "duo").map((m, i, l) => `gte(t\\,${i ? m.a : -1e6})*lt(t\\,${i < l.length - 1 ? m.b : 1e6})*${CENTRES[m.mode as keyof typeof CENTRES]}`).join("+") || "0.5";
  const duo = ms.filter((m) => m.mode === "duo").map((m) => `between(t\\,${m.a}\\,${round(m.b - 0.001, 1000)})`).join("+") || "0";
  // Haut/bas : chaque moitié de l'image (gauche en haut, droite en bas), un peu rognée en hauteur pour faire 1080×960.
  const moitie = (cote: 0 | 1, nom: string) => `crop=w=min(iw/2\\,ih*9/8):h=min(iw/2\\,ih*9/8)*8/9:x=${cote ? "iw-ow" : "0"}:y=(ih-oh)*0.35,scale=1080:960,setsar=1[${nom}]`;
  return [
    `[0:v]fps=${IPS},split=3[s0][s1][s2]`,
    `[s0]crop=w=min(iw\\,ih*9/16):h=ih:x=max(0\\,min(iw-ow\\,(${x})*iw-ow/2)),scale=1080:1920,setsar=1[plein]`,
    `[s1]${moitie(0, "haut")}`,
    `[s2]${moitie(1, "bas")}`,
    "[haut][bas]vstack[duo]",
    `[plein][duo]overlay=enable=${duo},setsar=1[vout]`,
  ].join(";");
}

/** Stream de jeu : la webcam entière en haut, le jeu en dessous (milieu de l'image). `box` : la webcam dans l'image
 *  source, entre 0 et 1 ; `src` : la taille de l'image source. Rend le filtre et la hauteur de la webcam dans le Short
 *  (les sous-titres se posent sur la séparation). */
export function filtreWebcam(box: [number, number, number, number], src: { largeur: number; hauteur: number }): { filtre: string; hautCam: number } {
  // Un peu à l'intérieur du cadre, pour ne pas garder sa bordure.
  const m = 0.004, [x, y, w, h] = [box[0] + m, box[1] + m, box[2] - 2 * m, box[3] - 2 * m];
  const hautCam = Math.min(860, Math.max(560, Math.round(1080 * (h * src.hauteur) / (w * src.largeur) / 2) * 2));
  const hautJeu = 1920 - hautCam;
  const f = (n: number) => n.toFixed(4);
  return {
    hautCam,
    filtre: [
      `[0:v]fps=${IPS},split=2[c][j]`,
      `[c]crop=w=iw*${f(w)}:h=ih*${f(h)}:x=iw*${f(x)}:y=ih*${f(y)},scale=1080:${hautCam}:force_original_aspect_ratio=increase,crop=1080:${hautCam},setsar=1[cam]`,
      `[j]crop=w=min(iw\\,ih*1080/${hautJeu}):h=ih:x=(iw-ow)/2:y=0,scale=1080:${hautJeu},setsar=1[jeu]`,
      "[cam][jeu]vstack,setsar=1[vout]",
    ].join(";"),
  };
}
