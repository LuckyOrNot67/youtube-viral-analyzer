import "server-only";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

// FFmpeg (binaire fourni par ffmpeg-static), commun à l'analyse et au montage.
export function ffmpeg(args: string[], onTime?: (sec: number) => void, complet = false): Promise<string> {
  return run(args, onTime, complet).then((r) => (r.code === 0 ? r.log : Promise.reject(new Error(`FFmpeg ${r.code} : ${r.log.slice(-800)}`))));
}

/** Lance FFmpeg et rend son journal, même s'il échoue (le début contient la description des pistes). Un long journal
 *  est raccourci au milieu, sauf avec `complet` (quand on a besoin de chaque ligne, comme les changements de plan). */
function run(args: string[], onTime?: (sec: number) => void, complet = false): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath as unknown as string, ["-hide_banner", "-y", ...args]);
    let head = "", tail = "";
    p.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      if (complet || head.length < 12000) head += s; else tail = (tail + s).slice(-8000);
      const m = s.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m && onTime) onTime(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    p.on("close", (code) => resolve({ code, log: head + tail }));
    p.on("error", reject);
  });
}

/** Durée et présence d'une piste son lisible. Les iPhone ajoutent une piste « audio spatial » (apac) que FFmpeg
 *  ne lit pas : on ignore son erreur, l'important est la piste AAC normale. */
export async function probe(file: string) {
  const { log } = await run(["-i", file, "-map", "0:v:0", "-f", "null", "-t", "0", "-"]).catch(() => ({ log: "" }));
  const d = log.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const taille = log.match(/Stream #.*Video: .*?, (\d{2,5})x(\d{2,5})/);
  return {
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    hasAudio: /Stream #.*Audio: (aac|mp3|opus|pcm|alac|ac3|vorbis|flac)/.test(log),
    largeur: taille ? Number(taille[1]) : 1920, hauteur: taille ? Number(taille[2]) : 1080,
  };
}

/** Chaque image qui change un peu du tout au tout (détection de scène) et à quel point (0 à 1). Le montage auto s'en
 *  sert pour caler un changement de cadre sur l'image exacte où le plan change. */
export async function scenesDe(file: string, seuil = 0.05): Promise<{ t: number; score: number }[]> {
  const log = await ffmpeg(["-i", file, "-vf", `select='gt(scene,${seuil})',metadata=print`, "-an", "-f", "null", "-"], undefined, true).catch(() => "");
  const out: { t: number; score: number }[] = [];
  for (const m of log.matchAll(/pts_time:([\d.]+)[\s\S]*?lavfi\.scene_score=([\d.]+)/g)) out.push({ t: Number(m[1]), score: Number(m[2]) });
  return out;
}

/** Moments des changements de plan (détection de scène) : sert à mesurer le rythme d'une vidéo.
 *  `seuil` plus bas : trouve aussi les changements entre deux plans de mêmes couleurs (et quelques faux). */
export async function sceneCuts(file: string, seuil = 0.25): Promise<number[]> {
  const log = await ffmpeg(["-i", file, "-vf", `select='gt(scene,${seuil})',showinfo`, "-an", "-f", "null", "-"], undefined, true).catch(() => "");
  const cuts: number[] = [];
  for (const m of log.matchAll(/pts_time:([\d.]+)/g)) {
    const t = Number(m[1]);
    if (!cuts.length || t - cuts[cuts.length - 1] > 0.3) cuts.push(t); // un même changement détecté sur plusieurs images
  }
  return cuts;
}
