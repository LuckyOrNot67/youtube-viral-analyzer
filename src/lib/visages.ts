import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Echantillon } from "./montage";

// Les visages d'un passage, 5 fois par seconde, par le détecteur YuNet d'OpenCV (scripts/visages.py, installé par
// npm run setup). Gratuit et rapide : environ 3 s pour une minute de vidéo.

const PYTHON = path.join(process.cwd(), ".cache/ytdlp/bin/python");
const MODELE = path.join(process.cwd(), ".cache/modeles/yunet.onnx");
const SCRIPT = path.join(process.cwd(), "scripts/visages.py");

export const hasVisages = () => existsSync(PYTHON) && existsSync(MODELE);

/** `debut` et `duree` : le passage dans le fichier ; les temps rendus partent de `debut`. */
export function visagesDe(fichier: string, debut: number, duree: number): Promise<Echantillon[]> {
  if (!hasVisages()) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, [SCRIPT, fichier, MODELE, "5", debut.toFixed(2), String(duree)]);
    let out = "", err = "";
    p.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    p.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Détection des visages : ${err.slice(-300)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error("Détection des visages : réponse illisible")); }
    });
    p.on("error", reject);
  });
}
