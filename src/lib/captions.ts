// Sous-titres animés, mot par mot, comme sur TikTok : on fabrique un fichier de sous-titres stylés (format ASS) que
// FFmpeg dessine sur le Short (filtre « ass », police Poppins dans assets/fonts). Trois styles :
// - « classique » : trois mots à la fois, en majuscules blanches à contour noir, le mot dit en jaune ;
// - « pop » : un seul mot à la fois, en grand, qui apparaît en grossissant ;
// - « neon » : une petite phrase en minuscules, le mot dit en vert citron, un peu plus gros.
// Les mots arrivent minutés depuis le début du Short (voir sous-titres.ts et ai/traduction.ts).

export type StyleST = "classique" | "pop" | "neon";
export type MotST = { t: number; fin: number; mot: string };
/** Les sous-titres de YouTube au format json3 : des bouts de phrase, chacun découpé en mots (`tOffsetMs` : quand le
 *  mot commence, depuis le début du bout de phrase ; seulement pour les sous-titres automatiques). */
export type SousTitresJson3 = { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[] };

/** Chaque mot avec son minutage. Un bout de phrase sans minutage par mot (sous-titres écrits par la chaîne) : ses
 *  mots se partagent sa durée, selon leur longueur. */
export function lireMots(j: SousTitresJson3): MotST[] {
  const out: MotST[] = [];
  const ev = (j.events ?? []).filter((e) => (e.segs ?? []).some((s) => (s.utf8 ?? "").trim()));
  ev.forEach((e, i) => {
    const debut = (e.tStartMs ?? 0) / 1000;
    const fin = Math.min(debut + (e.dDurationMs ?? 0) / 1000, ev[i + 1] ? (ev[i + 1].tStartMs ?? 0) / 1000 : Infinity);
    const segs = (e.segs ?? []).filter((s) => (s.utf8 ?? "").trim());
    if (segs.length > 1 && segs.slice(1).every((s) => s.tOffsetMs !== undefined)) {
      segs.forEach((s, k) => out.push({ t: debut + (s.tOffsetMs ?? 0) / 1000, fin: k < segs.length - 1 ? debut + (segs[k + 1].tOffsetMs ?? 0) / 1000 : fin, mot: (s.utf8 ?? "").trim() }));
      return;
    }
    const mots = segs.map((s) => s.utf8 ?? "").join("").split(/\s+/).filter(Boolean);
    const total = mots.reduce((n, m) => n + m.length + 1, 0);
    let t = debut;
    for (const m of mots) { const d = (fin - debut) * (m.length + 1) / total; out.push({ t, fin: t + d, mot: m }); t += d; }
  });
  return out.map((m) => ({ t: Math.round(m.t * 1000) / 1000, fin: Math.round(m.fin * 1000) / 1000, mot: m.mot }));
}


/** Les mots regroupés en lignes affichées ensemble : coupées sur une pause, une fin de phrase, ou quand la ligne est
 *  pleine. */
export function lignes(mots: MotST[], maxMots: number, maxCar: number): MotST[][] {
  const out: MotST[][] = [];
  let cur: MotST[] = [];
  for (const m of mots) {
    const prev = cur.at(-1);
    const pleine = cur.length >= maxMots || [...cur, m].map((x) => x.mot).join(" ").length > maxCar;
    if (prev && (pleine || m.t - prev.fin > 0.35 || /[.!?…]$/.test(prev.mot))) { out.push(cur); cur = []; }
    cur.push(m);
  }
  if (cur.length) out.push(cur);
  return out;
}

const temps = (s: number) => {
  const c = Math.max(0, Math.round(s * 100));
  return `${Math.floor(c / 360000)}:${String(Math.floor(c / 6000) % 60).padStart(2, "0")}:${String(Math.floor(c / 100) % 60).padStart(2, "0")}.${String(c % 100).padStart(2, "0")}`;
};
/** Le texte tel quel, sans ce qui serait lu comme une commande de style. */
const propre = (s: string) => s.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
/** Couleurs au format ASS (&HBBGGRR&). */
const JAUNE = "&H2EE6FF&", CITRON = "&H6BF5D9&", BLANC = "&HFFFFFF&";

/** Le fichier de sous-titres. `milieu(t)` : vrai quand l'image est coupée en deux (haut/bas) : les sous-titres se
 *  placent alors sur la séparation (au milieu de l'écran, ou à `ySeparation` : sous la webcam d'un stream). */
export function fichierAss(tous: MotST[], style: StyleST, o: { largeur: number; hauteur: number; milieu?: (t: number) => boolean; ySeparation?: number }): string {
  // Sans les annotations des sous-titres automatiques : « [Musique] », « [Applaudissements] », « [Cri] »…
  const mots = tous.map((m) => ({ ...m, mot: m.mot.replace(/\[[^\]]*\]?|\]/g, "").trim() })).filter((m) => m.mot);
  const vertical = o.hauteur > o.largeur;
  const k = vertical ? 1 : 0.8;
  const taille = Math.round((style === "pop" ? 170 : style === "neon" ? 110 : 118) * k);
  const police = style === "pop" ? "Poppins Black" : "Poppins ExtraBold";
  // Assez haut pour ne pas passer sous les boutons et la légende de TikTok.
  const bas = vertical ? Math.round(o.hauteur * 0.7) : Math.round(o.hauteur * 0.88);
  const sep = o.ySeparation ?? o.hauteur / 2;
  const pos = (t: number) => (o.milieu?.(t) ? `\\an5\\pos(${o.largeur / 2},${sep})` : `\\an2\\pos(${o.largeur / 2},${bas})`);
  const ev: string[] = [];
  const dial = (a: number, b: number, texte: string) => ev.push(`Dialogue: 0,${temps(a)},${temps(b)},Base,,0,0,0,,${texte}`);

  if (style === "pop") {
    const couleurs = [BLANC, JAUNE, CITRON];
    mots.forEach((m, i) => {
      const b = Math.max(m.fin, Math.min(m.t + 0.25, mots[i + 1]?.t ?? m.fin + 0.3));
      dial(m.t, mots[i + 1] ? Math.min(b, mots[i + 1].t) : b, `{${pos(m.t)}\\c${couleurs[i % 3]}\\fscx70\\fscy70\\t(0,90,\\fscx100\\fscy100)}${propre(m.mot).toUpperCase()}`);
    });
  } else {
    const groupes = style === "classique" ? lignes(mots, 3, 18) : lignes(mots, 4, 24);
    groupes.forEach((g, gi) => {
      // La ligne reste jusqu'à la suivante si le silence est court : pas de clignotement entre deux lignes.
      const suivante = groupes[gi + 1]?.[0].t;
      const finGroupe = suivante !== undefined && suivante - g.at(-1)!.fin < 0.5 ? suivante : g.at(-1)!.fin + 0.15;
      g.forEach((m, i) => {
        const b = i < g.length - 1 ? g[i + 1].t : finGroupe;
        const texte = g.map((x, j) => {
          const mot = propre(style === "classique" ? x.mot.toUpperCase() : x.mot);
          if (j !== i) return `{\\c${BLANC}\\fscx100\\fscy100}${mot}`;
          return style === "neon" ? `{\\c${CITRON}\\fscx112\\fscy112}${mot}` : `{\\c${JAUNE}\\fscx108\\fscy108}${mot}`;
        }).join(" ");
        dial(m.t, b, `{${pos(m.t)}}${texte}`);
      });
    });
  }

  const contour = style === "neon" ? 6 : 8;
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${o.largeur}`, `PlayResY: ${o.hauteur}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Base,${police},${taille},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,${contour},${style === "neon" ? 0 : 3},2,60,60,0,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...ev, "",
  ].join("\n");
}
