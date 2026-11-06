import "server-only";
import { readFile, rm } from "node:fs/promises";
import * as z from "zod/v4";
import { cached } from "../db";
import type { MotST } from "../captions";
import { ffmpeg } from "./ffmpeg";
import { bienFormes, geminiWatchClip, jsonIn } from "./models";
import LIMITES from "@/config/limites.json";

// Ce qui est dit dans un passage sans sous-titres (un clip Twitch) : Gemini écoute le passage déjà téléchargé et note
// de petits bouts de phrase minutés ; leurs mots se partagent ensuite la durée de chaque bout. Moins précis que le mot
// par mot de YouTube, mais calé sur la voix. Gardé 7 jours, pour tout le monde.

const Bout = z.object({ start: z.number(), end: z.number(), texte: z.string() });

/** Les mots du passage [debut, debut + duree] du fichier, minutés depuis `debut`. */
export async function transcrire(projet: string, fichier: string, debut: number, duree: number): Promise<MotST[]> {
  const { value } = await cached(`transcr:${projet}:${Math.round(debut)}-${Math.round(duree)}`, LIMITES.cache.extraitsHeures, async () => {
    // Une copie légère : l'image compte peu ici, c'est le son qu'il faut.
    const leger = `${fichier}.${Math.round(debut)}.voix.mp4`;
    await ffmpeg(["-ss", debut.toFixed(2), "-i", fichier, "-t", String(duree), "-vf", "scale=-2:240,fps=5", "-c:v", "libx264", "-preset", "veryfast", "-crf", "34", "-ac", "1", "-c:a", "aac", "-b:a", "64k", leger]);
    try {
      const raw = jsonIn(await geminiWatchClip(projet, await readFile(leger), 0.2, PROMPT(duree), projet));
      return bienFormes((raw as { bouts?: unknown })?.bouts ?? raw, Bout);
    } finally {
      await rm(leger, { force: true });
    }
  });
  return value
    .map((b) => ({ ...b, start: Math.max(0, b.start), end: Math.min(duree, b.end) }))
    .filter((b) => b.end > b.start && b.texte.trim())
    .sort((a, b) => a.start - b.start)
    .flatMap((b) => {
      const mots = b.texte.split(/\s+/).filter(Boolean);
      const total = mots.reduce((n, m) => n + m.length + 1, 0);
      let t = b.start;
      return mots.map((mot) => { const d = (b.end - b.start) * (mot.length + 1) / total; const m = { t, fin: t + d, mot }; t += d; return m; });
    });
}

const PROMPT = (duree: number) => `Transcris mot pour mot tout ce qui est dit dans cette vidéo de ${Math.round(duree)} secondes, dans la langue parlée, avec la ponctuation.
Découpe en petits bouts de 2 à 8 mots, chacun avec le moment exact où il commence et finit (secondes depuis le début, une décimale). Ne résume pas, n'invente rien, ignore la musique et les bruits.
Réponds UNIQUEMENT avec un objet JSON : {"bouts": [{"start": 0.4, "end": 1.9, "texte": "…"}, …]}`;
