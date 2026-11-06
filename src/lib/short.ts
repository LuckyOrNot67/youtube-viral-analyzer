import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { ffmpeg, probe, scenesDe } from "./ai/ffmpeg";
import { logCost } from "./ai/events";
import { db } from "./db";
import { conseilDe } from "./format";
import { planParPlan } from "./ai/montage-ia";
import { filtreMontage, filtreWebcam, morceaux } from "./montage";
import type { Phrase } from "./sous-titres";
import { visagesDe, webcamDe } from "./visages";
import { estClip, urlClip } from "./sources";
import { fichierAss, type MotST, type StyleST } from "./captions";
import { enFrancais } from "./ai/traduction";
import { writeFile } from "node:fs/promises";
import LIMITES from "@/config/limites.json";

// Export d'un Short vertical à partir d'un passage d'une vidéo YouTube : yt-dlp télécharge seulement les passages
// (avec 1 s de marge), puis FFmpeg les cadre en 9:16 (ou garde l'horizontal), égalise le son et sort un MP4 1080×1920 (ou 1920×1080).
// Décision du fondateur (01/11/2026), contraire aux règles développeur YouTube (III.E.1) : voir docs/RECAP.md.
//
// Pour que YouTube ne bloque pas le serveur, on télécharge le moins possible : un passage téléchargé sert à tout le
// monde pendant 7 jours. Au premier export, on prend d'abord le passage demandé (pour ne pas faire attendre), puis
// tous les autres passages proposés à la personne, en un seul appel.

const YTDLP = process.env.YTDLP_PATH ?? path.join(process.cwd(), ".cache/ytdlp/bin/yt-dlp");
const DIR = path.join(process.cwd(), ".cache", "shorts");
const SOURCES = path.join(process.cwd(), ".cache", "sources");
const KEEP_MS = LIMITES.analyse.conservationJours * 86400_000;
/** Les polices des sous-titres animés (Poppins, licence libre). */
const POLICES = path.join(process.cwd(), "assets", "fonts");

export const hasDownloader = () => existsSync(YTDLP);

export type Cadrage = "centre" | "entier" | "horizontal" | "bandes" | "auto";
/** Pour le montage auto : les sous-titres de la vidéo (qui parle, et quand). */
export type InfosMontage = () => Promise<Phrase[]>;
/** Sous-titres animés : le style, la langue, et les mots minutés de la vidéo (depuis son début). `mots` reçoit le
 *  passage téléchargé : sans sous-titres (Twitch), on le fait écouter à l'IA. */
export type SousTitresDemande = { style: StyleST; langue: "orig" | "fr"; mots: (p: { fichier: string; offset: number; len: number; start: number }) => Promise<MotST[]> };
type Etat = "attente" | "telechargement" | "montage" | "pret" | "erreur";
export type ShortJob = {
  id: string; videoId: string; start: number; end: number; cadrage: Cadrage;
  etat: Etat; progression: number; erreur: string | null; createdAt: number; uid: string;
};
export type Passage = { start: number; end: number };

const g = globalThis as unknown as { __yvaJobs?: Map<string, ShortJob>; __yvaDl?: Map<string, { cles: Set<string>; fin: Promise<void> }> };
const jobs = (g.__yvaJobs ??= new Map());
/** Téléchargements en cours, par vidéo : les passages qu'ils vont rapporter. */
const enCours = (g.__yvaDl ??= new Map());

export const fileOf = (id: string) => path.join(DIR, `${id}.mp4`);
/** Où télécharger la vidéo : un clip Twitch (« tc_… »), sinon une vidéo YouTube. */
const sourceDe = (videoId: string) => (estClip(videoId) ? urlClip(videoId) : `https://www.youtube.com/watch?v=${videoId}`);
const marge = (p: Passage) => ({ from: Math.max(0, p.start - 1), to: p.end + 1 });
const cle = (p: Passage) => { const { from, to } = marge(p); return `${from}-${to}`; };
const sourceOf = (videoId: string, p: Passage) => path.join(SOURCES, videoId, `${cle(p)}.mp4`);
/** Le passage téléchargé, s'il existe. Près de la fin de la vidéo, yt-dlp raccourcit la fin du nom du fichier
 *  (109-669 au lieu de 109-671) : on accepte un fichier qui commence au même endroit et finit plus tôt. */
function trouver(videoId: string, p: Passage): string | null {
  const f = sourceOf(videoId, p);
  if (existsSync(f)) return f;
  const { from, to } = marge(p);
  const dir = path.join(SOURCES, videoId);
  const nom = existsSync(dir) ? readdirSync(dir).find((n) => { const m = /^(\d+)-(\d+)\.mp4$/.exec(n); return m && +m[1] === from && +m[2] < to && +m[2] >= p.end - 5; }) : null;
  return nom ? path.join(dir, nom) : null;
}

type Row = { id: string; user: string; video: string; start: number; end: number; cadrage: Cadrage; titre: string; video_titre: string; etat: Etat; erreur: string | null; at: number };

/** L'export en mémoire, sinon celui de la base (après un redémarrage, un export pas fini est perdu). */
export function getJob(id: string): ShortJob | null {
  const j = jobs.get(id);
  if (j) return j;
  const r = db().prepare("SELECT * FROM shorts WHERE id = ?").get(id) as Row | undefined;
  if (!r) return null;
  const fini = r.etat === "pret" || r.etat === "erreur";
  return {
    id: r.id, videoId: r.video, start: r.start, end: r.end, cadrage: r.cadrage, uid: r.user, createdAt: r.at, progression: fini ? 1 : 0,
    etat: fini ? r.etat : "erreur", erreur: fini ? r.erreur : "L'export a été interrompu. Relance-le.",
  };
}

/** Les Shorts de la personne (7 derniers jours), du plus récent au plus ancien. */
export function shortsDe(uid: string) {
  const rows = db().prepare("SELECT * FROM shorts WHERE user = ? AND at > ? ORDER BY at DESC").all(uid, Date.now() - KEEP_MS) as Row[];
  return rows.map((r) => ({ ...getJob(r.id)!, uid: undefined, titre: r.titre, videoTitre: r.video_titre, expireLe: r.at + KEEP_MS, fichier: existsSync(fileOf(r.id)) }));
}

/** Passages différents déjà exportés par la personne pour cette vidéo (les deux cadrages d'un passage comptent pour un ;
 *  les parties d'histoire ne comptent pas). */
export function exportesPour(uid: string, videoId: string): Passage[] {
  return db().prepare("SELECT DISTINCT start, end FROM shorts WHERE user = ? AND video = ? AND at > ? AND etat != 'erreur' AND partie IS NULL").all(uid, videoId, Date.now() - KEEP_MS) as Passage[];
}

/** Un même passage déjà demandé par la même personne n'est pas refait. `autres` : les passages à télécharger dans la foulée. */
export function startShort(o: { videoId: string; start: number; end: number; cadrage: Cadrage; uid: string; titre: string; videoTitre: string; autres: Passage[]; partie?: number; montage?: InfosMontage; sousTitres?: SousTitresDemande }): { job: ShortJob; nouveau: boolean } {
  const st = o.sousTitres ? `${o.sousTitres.style}:${o.sousTitres.langue}` : "";
  const row = db().prepare("SELECT id FROM shorts WHERE user = ? AND video = ? AND start = ? AND end = ? AND cadrage = ? AND sous_titres = ? AND at > ? AND etat != 'erreur'")
    .get(o.uid, o.videoId, o.start, o.end, o.cadrage, st, Date.now() - KEEP_MS) as { id: string } | undefined;
  const same = row && getJob(row.id);
  if (same && same.etat !== "erreur" && (same.etat !== "pret" || existsSync(fileOf(same.id)))) return { job: same, nouveau: false };
  const job: ShortJob = { id: randomUUID(), videoId: o.videoId, start: o.start, end: o.end, cadrage: o.cadrage, uid: o.uid, etat: "attente", progression: 0, erreur: null, createdAt: Date.now() };
  jobs.set(job.id, job);
  db().prepare("INSERT INTO shorts (id, user, video, start, end, cadrage, titre, video_titre, etat, erreur, at, partie, sous_titres) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'attente', NULL, ?, ?, ?)")
    .run(job.id, o.uid, o.videoId, o.start, o.end, o.cadrage, o.titre.slice(0, 200), o.videoTitre.slice(0, 200), job.createdAt, o.partie ?? null, st);
  run(job, o.autres, o.montage, o.sousTitres)
    .catch((e) => { job.etat = "erreur"; job.erreur = (e as Error).message; console.warn("[short]", (e as Error).message); })
    .finally(() => db().prepare("UPDATE shorts SET etat = ?, erreur = ? WHERE id = ?").run(job.etat, job.erreur, job.id));
  cleanup().catch(() => {});
  return { job, nouveau: true };
}

/** « centre » remplit l'écran vertical (recadré au milieu) ; « bandes » garde le milieu de l'image en 3:4, bien plus large,
 *  avec des bandes noires en haut et en bas (1080×1920) ; « horizontal » garde l'image entière en 1920×1080
 *  (TikTok ajoute des bandes noires), « entier » (ancien) la pose sur un fond flou. */
export function verticalFilter(c: Cadrage, centreX = 0.5): string {
  // Le cadre suit les personnes : `centreX` (0 à gauche, 1 à droite) est le milieu de la découpe, sans sortir de l'image.
  const x = Math.min(1, Math.max(0, centreX)).toFixed(2);
  const cx = `max(0\\,min(iw-ow\\,${x}*iw-ow/2))`;
  if (c === "bandes") return `[0:v]crop=w=min(iw\\,ih*3/4):h=min(ih\\,iw*4/3):x=${cx},scale=1080:1440,pad=1080:1920:0:240:black,setsar=1,fps=30[vout]`;
  if (c === "horizontal") return "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[vout]";
  if (c === "centre") return `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:${cx}:0,setsar=1,fps=30[vout]`;
  return "[0:v]split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.08[bg];"
    + "[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30[vout]";
}

/** Le passage brut, téléchargé une seule fois pour tout le monde. */
async function passageBrut(videoId: string, p: Passage, autres: Passage[]): Promise<string> {
  // Un téléchargement en cours qui rapporte ce passage : on l'attend.
  const dl = enCours.get(videoId);
  if (dl?.cles.has(cle(p))) await dl.fin.catch(() => {});
  const deja = trouver(videoId, p);
  if (deja) return deja;
  await telecharger(videoId, [p]);
  const f = trouver(videoId, p);
  if (!f) throw new Error("Le téléchargement du passage a échoué. Réessaie dans un instant.");
  // Dans la foulée, les autres passages proposés, en un seul appel (personne n'attend).
  const prevus = enCours.get(videoId)?.cles;
  const reste = autres.filter((x) => !trouver(videoId, x) && !prevus?.has(cle(x)));
  if (reste.length) telecharger(videoId, reste).catch((e) => console.warn("[short] lot :", (e as Error).message));
  return f;
}

async function telecharger(videoId: string, passages: Passage[]) {
  const dir = path.join(SOURCES, videoId);
  const cles = new Set(passages.map(cle));
  // Enregistré tout de suite (sans attendre) : un autre export du même passage attend ce téléchargement au lieu d'en lancer un second.
  const fin = (async () => {
    await mkdir(dir, { recursive: true });
    const t0 = Date.now();
    // YouTube refuse parfois un passage sur le moment (ffmpeg sort en erreur) : une seconde tentative suffit en général.
    const essai = () => ytdlp([
      "-q", "--no-warnings", "--no-playlist",
      "-f", "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
      ...passages.flatMap((p) => { const { from, to } = marge(p); return ["--download-sections", `*${from}-${to}`]; }),
      "--merge-output-format", "mp4", "--remux-video", "mp4",
      "--ffmpeg-location", ffmpegPath as unknown as string,
      "-o", path.join(dir, "%(section_start)s-%(section_end)s.%(ext)s"), sourceDe(videoId),
    ]);
    let { code, err } = await essai();
    if (code !== 0 && !/not a bot|sign in to confirm|private video|unavailable|members-only/i.test(err)) {
      await new Promise((r) => setTimeout(r, 3000));
      ({ code, err } = await essai());
    }
    logCost(videoId, "telechargement", { ms: Date.now() - t0, passages: passages.length, ok: code === 0 });
    if (code !== 0 && !passages.some((p) => trouver(videoId, p))) throw new Error(downloadError(err));
  })();
  const prev = enCours.get(videoId);
  const entree = { cles: new Set([...(prev?.cles ?? []), ...cles]), fin: Promise.all([prev?.fin, fin.catch(() => {})]).then(() => {}) };
  enCours.set(videoId, entree);
  entree.fin.then(() => { if (enCours.get(videoId) === entree) enCours.delete(videoId); });
  await fin;
}

async function run(job: ShortJob, autres: Passage[], montage?: InfosMontage, sousTitres?: SousTitresDemande) {
  const t0 = Date.now();
  await mkdir(DIR, { recursive: true });
  job.etat = "telechargement";
  const source = { start: job.start, end: job.end };
  const input = await passageBrut(job.videoId, source, autres);
  job.progression = 0.4;

  job.etat = "montage";
  const { duration, hasAudio, largeur, hauteur } = await probe(input);
  // Le passage téléchargé commence ~1 s avant ; on recale précisément sur le début demandé.
  const len = job.end - job.start;
  const offset = Math.max(0, Math.min(job.start - marge(source).from, Math.max(0, duration - len)));
  const centreX = conseilDe(job.videoId)?.centreX;
  let filtre = verticalFilter(job.cadrage === "auto" ? "bandes" : job.cadrage, centreX);
  let duos: { a: number; b: number }[] = [];
  // Stream de jeu : une webcam incrustée se met entière en haut du Short, le jeu en dessous (Montage auto, et aussi
  // Short fixe pour un clip Twitch).
  const cam = job.cadrage === "auto" || (estClip(job.videoId) && job.cadrage === "centre") ? await webcamDe(input, offset, len) : null;
  let separation: number | undefined;
  if (cam) {
    const w = filtreWebcam(cam, { largeur, hauteur });
    filtre = w.filtre;
    separation = w.hautCam;
    console.info(`[short] ${job.videoId} webcam en haut : ${cam.map((v) => v.toFixed(3)).join(" ")}`);
  } else if (job.cadrage === "auto" && montage) {
    // Montage auto : le détecteur trouve les personnes (corps, tête, qui parle, qui bouge), FFmpeg les changements de
    // plan, Gemini départage. Si Gemini ne répond pas, le montage se fait quand même.
    const phrases = (await montage().catch(() => [] as Phrase[]))
      .filter((p) => p.end > job.start && p.start < job.end).map((p) => ({ ...p, start: p.start - job.start, end: p.end - job.start }));
    const [plans, scenes, visages] = await Promise.all([
      planParPlan(job.videoId, job.start, job.end, input, offset, phrases).catch((e) => { console.warn("[short] montage auto :", (e as Error).message); return []; }),
      scenesDe(input),
      visagesDe(input, offset, len).catch((e) => { console.warn("[short]", (e as Error).message); return []; }),
    ]);
    // Les nets changements de plan, et tous les petits (pour caler sur l'image exacte ceux que seuls les visages trahissent).
    const dansLePassage = scenes.map((x) => ({ ...x, t: x.t - offset })).filter((x) => x.t > 0 && x.t < len);
    const coupes = dansLePassage.filter((x) => x.score >= 0.15).map((x) => x.t).filter((t, i, l) => i === 0 || t - l[i - 1] > 0.3);
    const ms = morceaux(plans, len, coupes, phrases.map((p) => p.start), visages, dansLePassage.map((x) => x.t));
    console.info(`[short] ${job.videoId} montage auto : ${plans.length} notes de Gemini, ${coupes.length} plans, ${ms.length} morceaux (${ms.map((m) => `${m.a}:${m.mode}`).join(" ")})`);
    filtre = filtreMontage(ms);
    duos = ms.filter((m) => m.mode === "duo");
  }
  if (sousTitres) {
    // Sous-titres animés : les mots du passage (traduits si demandé), dessinés par-dessus l'image finale.
    const mots = (await sousTitres.mots({ fichier: input, offset, len, start: job.start }).catch((e) => { console.warn("[short] sous-titres :", (e as Error).message); return [] as MotST[]; }))
      .filter((m) => m.t >= job.start - 0.2 && m.t < job.end).map((m) => ({ ...m, t: Math.max(0, m.t - job.start), fin: Math.min(len, m.fin - job.start) }));
    const dits = sousTitres.langue === "fr" ? await enFrancais(mots, `${job.videoId}:${job.start}-${job.end}`).catch(() => mots) : mots;
    if (dits.length) {
      const horizontal = job.cadrage === "horizontal";
      const ass = `${fileOf(job.id)}.ass`;
      await writeFile(ass, fichierAss(dits, sousTitres.style, { largeur: horizontal ? 1920 : 1080, hauteur: horizontal ? 1080 : 1920, milieu: (t) => separation !== undefined || duos.some((d) => t >= d.a && t < d.b), ySeparation: separation }));
      const echappe = (f: string) => f.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
      filtre = `${filtre.replace(/\[vout\]$/, "[v0]")};[v0]ass=filename=${echappe(ass)}:fontsdir=${echappe(POLICES)}[vout]`;
    }
    console.info(`[short] ${job.videoId} sous-titres ${sousTitres.style}/${sousTitres.langue} : ${dits.length} mots`);
  }
  await ffmpeg([
    "-ss", offset.toFixed(2), "-i", input, "-t", String(len),
    "-filter_complex", filtre, "-map", "[vout]",
    ...(hasAudio ? ["-map", "0:a:0", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "160k", "-ar", "48000"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    fileOf(job.id),
  ], (sec) => { job.progression = 0.4 + 0.6 * Math.min(1, sec / len); });
  job.progression = 1;
  job.etat = "pret";
  logCost(job.videoId, "short", { ms: Date.now() - t0, duree: len, cadrage: job.cadrage });
}

function downloadError(err: string): string {
  // On ne contourne aucune vérification anti-robot : on le dit clairement.
  if (/confirm you.?re not a bot|sign in to confirm/i.test(err)) return "YouTube demande une vérification anti-robot pour télécharger cette vidéo depuis ce serveur. Export impossible pour le moment.";
  if (/private video|video unavailable|removed/i.test(err)) return "Cette vidéo n'est plus disponible sur YouTube.";
  if (/age|inappropriate/i.test(err)) return "Vidéo réservée aux adultes : YouTube ne la donne pas sans compte.";
  if (/members-only|join this channel/i.test(err)) return "Vidéo réservée aux membres de la chaîne.";
  if (/live/i.test(err)) return "Impossible d'exporter un direct en cours.";
  console.warn("[short] yt-dlp :", err.slice(-600));
  return "Le téléchargement du passage a échoué. Réessaie dans un instant.";
}

/** Lance yt-dlp. `out` : ce qu'il écrit sur sa sortie (les fiches JSON avec -j), `err` : la fin de son journal. */
export function ytdlp(args: string[]): Promise<{ code: number | null; err: string; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args);
    let err = "", out = "";
    p.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    p.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
    p.on("close", (code) => resolve({ code, err, out }));
    p.on("error", reject);
  });
}

/** Les Shorts et les passages téléchargés sont effacés au bout de 7 jours. */
async function cleanup() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.createdAt > KEEP_MS) jobs.delete(id);
  const vieux = async (p: string) => { const s = await stat(p).catch(() => null); return s && now - s.mtimeMs > KEEP_MS; };
  for (const f of await readdir(DIR).catch(() => [])) {
    if (await vieux(path.join(DIR, f))) await rm(path.join(DIR, f), { recursive: true, force: true }).catch(() => {});
  }
  for (const v of await readdir(SOURCES).catch(() => [])) {
    for (const f of await readdir(path.join(SOURCES, v)).catch(() => [])) {
      if (await vieux(path.join(SOURCES, v, f))) await rm(path.join(SOURCES, v, f), { force: true }).catch(() => {});
    }
  }
}
