import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { ffmpeg, probe } from "./ai/ffmpeg";
import { logCost } from "./ai/events";

// Export d'un Short vertical à partir d'un passage d'une vidéo YouTube : yt-dlp télécharge seulement le passage
// (avec 1 s de marge), puis FFmpeg le cadre en 9:16, égalise le son et sort un MP4 1080×1920.
// Décision du fondateur (01/11/2026), contraire aux règles développeur YouTube (III.E.1) : voir docs/RECAP.md.

const YTDLP = process.env.YTDLP_PATH ?? path.join(process.cwd(), ".cache/ytdlp/bin/yt-dlp");
const DIR = path.join(process.cwd(), ".cache", "shorts");
const KEEP_MS = 24 * 3600_000;

export const hasDownloader = () => existsSync(YTDLP);

export type Cadrage = "centre" | "entier";
export type ShortJob = {
  id: string; videoId: string; start: number; end: number; cadrage: Cadrage;
  etat: "attente" | "telechargement" | "montage" | "pret" | "erreur";
  progression: number; erreur: string | null; createdAt: number; uid: string;
};

const g = globalThis as unknown as { __yvaJobs?: Map<string, ShortJob> };
const jobs = (g.__yvaJobs ??= new Map());

export const getJob = (id: string) => jobs.get(id) ?? null;
export const fileOf = (id: string) => path.join(DIR, `${id}.mp4`);

/** Un même passage déjà demandé par la même personne n'est pas refait. */
export function startShort(o: { videoId: string; start: number; end: number; cadrage: Cadrage; uid: string }): ShortJob {
  const same = [...jobs.values()].find((j) => j.uid === o.uid && j.videoId === o.videoId && j.start === o.start && j.end === o.end && j.cadrage === o.cadrage && j.etat !== "erreur");
  if (same) return same;
  const job: ShortJob = { id: randomUUID(), ...o, etat: "attente", progression: 0, erreur: null, createdAt: Date.now() };
  jobs.set(job.id, job);
  run(job).catch((e) => { job.etat = "erreur"; job.erreur = (e as Error).message; console.warn("[short]", (e as Error).message); });
  cleanup().catch(() => {});
  return job;
}

/** Filtre vertical : « centre » remplit l'écran (recadré au milieu), « entier » garde toute l'image sur un fond flou. */
export function verticalFilter(c: Cadrage): string {
  if (c === "centre") return "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[vout]";
  return "[0:v]split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.08[bg];"
    + "[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30[vout]";
}

async function run(job: ShortJob) {
  const t0 = Date.now();
  await mkdir(DIR, { recursive: true });
  const work = path.join(DIR, `${job.id}-src`);
  await mkdir(work, { recursive: true });
  try {
    job.etat = "telechargement";
    const from = Math.max(0, job.start - 1), to = job.end + 1;
    const { code, err } = await ytdlp([
      "-q", "--no-warnings", "--no-playlist", "--no-part",
      "-f", "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
      "--download-sections", `*${from}-${to}`, "--merge-output-format", "mp4",
      "--ffmpeg-location", ffmpegPath as unknown as string,
      "-o", path.join(work, "src.%(ext)s"), `https://www.youtube.com/watch?v=${job.videoId}`,
    ]);
    const src = (await readdir(work)).find((f) => /^src\.(mp4|mkv|webm)$/.test(f));
    if (code !== 0 || !src) throw new Error(downloadError(err));
    job.progression = 0.4;

    job.etat = "montage";
    const input = path.join(work, src);
    const { duration, hasAudio } = await probe(input);
    // Le passage téléchargé commence ~1 s avant ; on recale précisément sur le début demandé.
    const offset = Math.max(0, Math.min(job.start - from, Math.max(0, duration - (job.end - job.start))));
    const len = job.end - job.start;
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
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
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

/** Les Shorts générés sont effacés au bout de 24 h. */
async function cleanup() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.createdAt > KEEP_MS) jobs.delete(id);
  for (const f of await readdir(DIR).catch(() => [])) {
    const p = path.join(DIR, f);
    const s = await stat(p).catch(() => null);
    if (s && now - s.mtimeMs > KEEP_MS) await rm(p, { recursive: true, force: true }).catch(() => {});
  }
}
