import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { Echantillon } from "./montage";

// Ce qui se passe à l'image d'un passage, 5 fois par seconde (scripts/personnes.py, installé par npm run setup) : les
// corps et les visages, la bouche qui bouge, les gestes, le volume de la voix. Gratuit, environ 25 s par minute de vidéo.

const PYTHON = path.join(process.cwd(), ".cache/ytdlp/bin/python");
const YUNET = path.join(process.cwd(), ".cache/modeles/yunet.onnx");
const YOLOX = path.join(process.cwd(), ".cache/modeles/yolox.onnx");
const SCRIPT = path.join(process.cwd(), "scripts/personnes.py");

export const hasVisages = () => existsSync(PYTHON) && existsSync(YUNET) && existsSync(YOLOX);

/** `debut` et `duree` : le passage dans le fichier ; les temps rendus partent de `debut`. */
export function visagesDe(fichier: string, debut: number, duree: number): Promise<Echantillon[]> {
  if (!hasVisages()) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, [SCRIPT, fichier, YUNET, YOLOX, ffmpegPath as unknown as string, debut.toFixed(2), String(duree)]);
    let out = "", err = "";
    p.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    p.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Analyse de l'image : ${err.slice(-300)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error("Analyse de l'image : réponse illisible")); }
    });
    p.on("error", reject);
  });
}

const WEBCAM = path.join(process.cwd(), "scripts/webcam.py");

/** La webcam incrustée dans le passage (stream de jeu) : [x, y, largeur, hauteur] entre 0 et 1, ou null. */
export function webcamDe(fichier: string, debut: number, duree: number): Promise<[number, number, number, number] | null> {
  if (!hasVisages()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const p = spawn(PYTHON, [WEBCAM, fichier, YUNET, debut.toFixed(2), String(duree)]);
    let out = "";
    p.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    p.on("close", () => { try { resolve(JSON.parse(out).box ?? null); } catch { resolve(null); } });
    p.on("error", () => resolve(null));
  });
}
