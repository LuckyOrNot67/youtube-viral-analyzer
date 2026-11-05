import "server-only";
import { readFile, rm } from "node:fs/promises";
import { cached } from "../db";
import { lirePlans, type Plan } from "../montage";
import type { Phrase } from "../sous-titres";
import { ffmpeg } from "./ffmpeg";
import { geminiWatchClip, jsonIn } from "./models";
import LIMITES from "@/config/limites.json";

// Montage auto : qui suivre, plan par plan. Le grand visionnage (visionnage.ts) ne voit qu'une image toutes les 2 à 4 s
// et répond trop grossièrement pour ça. Ici Gemini regarde seulement le passage, déjà téléchargé, en basse définition
// et à 2 images par seconde : environ 0,3 centime pour un Short d'une minute. Gardé 7 jours, pour tout le monde.

const FPS = 2;

/** Les changements de cadre du passage, en secondes depuis le début du passage. `phrases` : en secondes depuis le début du passage. */
export async function planParPlan(videoId: string, start: number, end: number, fichier: string, offset: number, phrases: Phrase[]): Promise<Plan[]> {
  const len = end - start;
  const { value } = await cached(`montage:${videoId}:${start}-${end}`, LIMITES.cache.extraitsHeures, async () => {
    // Une copie légère du passage (360p, son mono) : quelques Mo, envoyés avec la demande.
    const leger = `${fichier}.${start}-${end}.leger.mp4`;
    await ffmpeg(["-ss", offset.toFixed(2), "-i", fichier, "-t", String(len), "-vf", "scale=-2:360,fps=10", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-ac", "1", "-c:a", "aac", "-b:a", "48k", leger]);
    try {
      const raw = jsonIn(await geminiWatchClip(videoId, await readFile(leger), FPS, prompt(len, phrases), videoId));
      return lirePlans((raw as { montage?: unknown })?.montage ?? raw);
    } finally {
      await rm(leger, { force: true });
    }
  });
  return value;
}

function prompt(len: number, phrases: Phrase[]): string {
  return `Cette vidéo de ${Math.round(len)} s doit être montée en vertical pour TikTok (9:16). Regarde-la en entier et dis, du début à la fin, qui le cadre doit suivre.

Note une entrée à chaque changement de plan de la caméra et chaque fois qu'une autre personne prend la parole. Dans une vidéo montée vite (film, série, bêtisier, plateau), c'est toutes les 1 à 5 secondes. Minutages précis, avec une décimale.
- [secondes, "un", x] : plein écran sur une personne. Si plusieurs personnes sont à l'écran : celle qui parle ; si tout le monde parle en même temps, celle qui parle le plus ou le personnage principal à cet instant (celui à qui il arrive quelque chose, celui qui fait rire) ; si quelqu'un a une réaction forte (fou rire, choc) pendant que l'autre parle, tu peux passer sur lui.
- [secondes, "duo", x_haut, x_bas] : écran coupé, une personne en haut, l'autre en bas. Seulement pour deux personnes éloignées l'une de l'autre dans l'image, qui se parlent et se répondent vite.
- [secondes, "rien"] : seulement quand il n'y a vraiment personne à suivre (décor, texte à l'écran, foule lointaine).
x = où est le visage de la personne dans la largeur de l'image : 0 = bord gauche, 0.5 = milieu, 1 = bord droit. Regarde vraiment l'image : une personne est rarement pile au milieu.
${phrases.length ? `\nCe qui est dit, avec les minutages :\n${phrases.map((p) => `${p.start.toFixed(1)} s : ${p.texte}`).join("\n")}\n` : ""}
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"montage": [[0, "un", 0.34], [2.5, "un", 0.71], [6.2, "duo", 0.22, 0.8], …]}`;
}
