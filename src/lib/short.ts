import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { ffmpeg, probe } from "./ai/ffmpeg";
import { logCost } from "./ai/events";
import { db } from "./db";
import LIMITES from "@/config/limites.json";

// Export d'un Short vertical à partir d'un passage d'une vidéo YouTube : yt-dlp télécharge seulement les passages
// (avec 1 s de marge), puis FFmpeg les cadre en 9:16, égalise le son et sort un MP4 1080×1920.
// Décision du fondateur (01/11/2026), contraire aux règles développeur YouTube (III.E.1) : voir docs/RECAP.md.
//
// Pour que YouTube ne bloque pas le serveur, on télécharge le moins possible : un passage téléchargé sert à tout le
// monde pendant 7 jours. Au premier export, on prend d'abord le passage demandé (pour ne pas faire attendre), puis
// tous les autres passages proposés à la personne, en un seul appel.

const YTDLP = process.env.YTDLP_PATH ?? path.join(process.cwd(), ".cache/ytdlp/bin/yt-dlp");
const DIR = path.join(process.cwd(), ".cache", "shorts");
const SOURCES = path.join(process.cwd(), ".cache", "sources");
const KEEP_MS = LIMITES.analyse.conservationJours * 86400_000;

export const hasDownloader = () => existsSync(YTDLP);

export type Cadrage = "centre" | "entier";
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
const marge = (p: Passage) => ({ from: Math.max(0, p.start - 1), to: p.end + 1 });
const cle = (p: Passage) => { const { from, to } = marge(p); return `${from}-${to}`; };
const sourceOf = (videoId: string, p: Passage) => path.join(SOURCES, videoId, `${cle(p)}.mp4`);

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

/** Passages différents déjà exportés par la personne pour cette vidéo (les deux cadrages d'un passage comptent pour un). */
export function exportesPour(uid: string, videoId: string): Passage[] {
  return db().prepare("SELECT DISTINCT start, end FROM shorts WHERE user = ? AND video = ? AND at > ? AND etat != 'erreur'").all(uid, videoId, Date.now() - KEEP_MS) as Passage[];
}

/** Un même passage déjà demandé par la même personne n'est pas refait. `autres` : les passages à télécharger dans la foulée. */
export function startShort(o: { videoId: string; start: number; end: number; cadrage: Cadrage; uid: string; titre: string; videoTitre: string; autres: Passage[] }): { job: ShortJob; nouveau: boolean } {
  const row = db().prepare("SELECT id FROM shorts WHERE user = ? AND video = ? AND start = ? AND end = ? AND cadrage = ? AND at > ? AND etat != 'erreur'")
    .get(o.uid, o.videoId, o.start, o.end, o.cadrage, Date.now() - KEEP_MS) as { id: string } | undefined;
  const same = row && getJob(row.id);
  if (same && same.etat !== "erreur" && (same.etat !== "pret" || existsSync(fileOf(same.id)))) return { job: same, nouveau: false };
  const job: ShortJob = { id: randomUUID(), videoId: o.videoId, start: o.start, end: o.end, cadrage: o.cadrage, uid: o.uid, etat: "attente", progression: 0, erreur: null, createdAt: Date.now() };
  jobs.set(job.id, job);
  db().prepare("INSERT INTO shorts (id, user, video, start, end, cadrage, titre, video_titre, etat, erreur, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'attente', NULL, ?)")
    .run(job.id, o.uid, o.videoId, o.start, o.end, o.cadrage, o.titre.slice(0, 200), o.videoTitre.slice(0, 200), job.createdAt);
  run(job, o.autres)
    .catch((e) => { job.etat = "erreur"; job.erreur = (e as Error).message; console.warn("[short]", (e as Error).message); })
    .finally(() => db().prepare("UPDATE shorts SET etat = ?, erreur = ? WHERE id = ?").run(job.etat, job.erreur, job.id));
  cleanup().catch(() => {});
  return { job, nouveau: true };
}

/** Filtre vertical : « centre » remplit l'écran (recadré au milieu), « entier » garde toute l'image sur un fond flou. */
export function verticalFilter(c: Cadrage): string {
  if (c === "centre") return "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[vout]";
  return "[0:v]split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.08[bg];"
    + "[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30[vout]";
}

/** Le passage brut, téléchargé une seule fois pour tout le monde. */
async function passageBrut(videoId: string, p: Passage, autres: Passage[]): Promise<string> {
  const f = sourceOf(videoId, p);
  if (existsSync(f)) return f;
  const dl = enCours.get(videoId);
  if (dl?.cles.has(cle(p))) {
    await dl.fin.catch(() => {});
    if (existsSync(f)) return f;
  }
  await telecharger(videoId, [p]);
  if (!existsSync(f)) throw new Error("Le téléchargement du passage a échoué. Réessaie dans un instant.");
  // Dans la foulée, les autres passages proposés, en un seul appel (personne n'attend).
  const prevus = enCours.get(videoId)?.cles;
  const reste = autres.filter((x) => !existsSync(sourceOf(videoId, x)) && !prevus?.has(cle(x)));
  if (reste.length) telecharger(videoId, reste).catch((e) => console.warn("[short] lot :", (e as Error).message));
  return f;
}

async function telecharger(videoId: string, passages: Passage[]) {
  const dir = path.join(SOURCES, videoId);
  await mkdir(dir, { recursive: true });
  const cles = new Set(passages.map(cle));
  const fin = (async () => {
    const t0 = Date.now();
    const { code, err } = await ytdlp([
      "-q", "--no-warnings", "--no-playlist", "--no-part",
      "-f", "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
      ...passages.flatMap((p) => { const { from, to } = marge(p); return ["--download-sections", `*${from}-${to}`]; }),
      "--merge-output-format", "mp4", "--remux-video", "mp4",
      "--ffmpeg-location", ffmpegPath as unknown as string,
      "-o", path.join(dir, "%(section_start)s-%(section_end)s.%(ext)s"), `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    logCost(videoId, "telechargement", { ms: Date.now() - t0, passages: passages.length, ok: code === 0 });
    if (code !== 0 && !passages.some((p) => existsSync(sourceOf(videoId, p)))) throw new Error(downloadError(err));
  })();
  const prev = enCours.get(videoId);
  const entree = { cles: new Set([...(prev?.cles ?? []), ...cles]), fin: Promise.all([prev?.fin, fin.catch(() => {})]).then(() => {}) };
  enCours.set(videoId, entree);
  entree.fin.then(() => { if (enCours.get(videoId) === entree) enCours.delete(videoId); });
  await fin;
}

async function run(job: ShortJob, autres: Passage[]) {
  const t0 = Date.now();
  await mkdir(DIR, { recursive: true });
  job.etat = "telechargement";
  const input = await passageBrut(job.videoId, job, autres);
  job.progression = 0.4;

  job.etat = "montage";
  const { duration, hasAudio } = await probe(input);
  // Le passage téléchargé commence ~1 s avant ; on recale précisément sur le début demandé.
  const len = job.end - job.start;
  const offset = Math.max(0, Math.min(job.start - marge(job).from, Math.max(0, duration - len)));
  await ffmpeg([
    "-ss", offset.toFixed(2), "-i", input, "-t", String(len),
    "-filter_complex", verticalFilter(job.cadrage), "-map", "[vout]",
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

function ytdlp(args: string[]): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args);
    let err = "";
    p.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
    p.on("close", (code) => resolve({ code, err }));
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
