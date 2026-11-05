import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { logCost } from "./events";
import LIMITES from "@/config/limites.json";

// Clés dans .env.local uniquement, jamais envoyées au navigateur.
/** Claude ne regarde pas la vidéo : il lit les résumés de Gemini et écrit note, titre, légende et hashtags.
 *  Haiku, le plus petit modèle, suffit (≈ 20 fois moins cher que Sonnet). */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
/** Images regardées par seconde de vidéo. Par défaut Gemini en prend environ 1 ; à 0,5, une vidéo de 30 min passe de
 *  ~103 k à ~66 k jetons, mêmes passages trouvés aux mêmes minutages (mesuré sur 4MphCDK8fWg). Le son reste entier. */
const GEMINI_FPS = Number(process.env.GEMINI_FPS ?? 0.5);
/** Au-delà de 45 min, deux fois moins d'images : une vidéo de 3 h coûterait sinon ~400 k jetons. */
const LONGUE = 45 * 60;
export const fpsPour = (duree: number) => (duree > LONGUE ? GEMINI_FPS / 2 : GEMINI_FPS);

export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

/** Client Claude dont chaque appel structuré enregistre son coût (jetons, durée). */
export function claude(projet: string) {
  const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const parse = c.messages.parse.bind(c.messages);
  c.messages.parse = (async (...args: Parameters<typeof parse>) => {
    const t0 = Date.now();
    const res = await parse(...args);
    logCost(projet, "claude", { modele: res.model, entree: res.usage.input_tokens, sortie: res.usage.output_tokens, ms: Date.now() - t0 });
    return res;
  }) as typeof parse;
  return c;
}

/** Gemini saturé (ou trop lent) même après quelques essais. On réessaiera plus tard, sans jamais passer à un modèle
 *  plus cher : un modèle de secours coûte 2,5 à 5 fois plus et ferait tomber la marge sous 80 %. */
export class GeminiSurcharge extends Error {
  constructor() { super("Gemini est surchargé en ce moment."); }
}
/** Vidéos pour lesquelles Flash-Lite est saturé depuis trop longtemps : on passe au modèle de secours (voir relance.ts). */
const g = globalThis as unknown as { __yvaSecours?: Set<string> };
const secours = (g.__yvaSecours ??= new Set());
export const autoriserSecours = (videoId: string, oui: boolean) => (oui ? secours.add(videoId) : secours.delete(videoId));

/** Pauses entre deux essais quand Gemini répond « saturé ». */
const PAUSES = [5_000, 15_000, 30_000];

/** Gemini regarde une vidéo YouTube publique à partir de son lien (aucun téléchargement de notre côté).
 *  Flash-Lite d'abord : saturé, on attend un peu et on réessaie ; toujours saturé, GeminiSurcharge. Le modèle de
 *  secours, plus cher, n'est utilisé qu'après plusieurs minutes de saturation (relance.ts). */
export async function geminiWatchYouTube(videoId: string, duree: number, prompt: string, projet: string, timeoutMs = 240_000): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const uri = `https://www.youtube.com/watch?v=${videoId}`;
  const model = secours.has(videoId) ? LIMITES.gemini.modeleSecours : GEMINI_MODEL;
  for (let essai = 0; ; essai++) {
    const t0 = Date.now();
    try {
      const res = await ai.interactions.create({
        model,
        input: [{ type: "video", uri, processing: { type: "static", fps: fpsPour(duree) } }, { type: "text", text: prompt }],
        generation_config: { thinking_level: "low" },
      }, { timeout_ms: timeoutMs });
      const out = res.output_text?.trim();
      if (!out) throw new Error("Gemini n'a rien répondu.");
      logCost(projet, "gemini", { modele: model, ms: Date.now() - t0, usage: (res as { usage?: unknown }).usage ?? null });
      return out;
    } catch (e) {
      const status = (e as { status?: number }).status;
      console.warn(`[gemini] ${model}, essai ${essai + 1} : ${status ?? (e as Error).message}`);
      // Sans statut : délai dépassé (déjà 4 min d'attente), on ne relance pas tout de suite.
      if (!status) throw (e as Error).message === "Gemini n'a rien répondu." ? e : new GeminiSurcharge();
      if (status !== 503 && status !== 429 && status !== 500) throw e;
      if (essai >= PAUSES.length) throw new GeminiSurcharge();
      await new Promise((r) => setTimeout(r, PAUSES[essai]));
    }
  }
}

/** Premier bloc JSON d'un texte (Gemini l'entoure parfois de ```json). */
export function jsonIn(text: string): unknown {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = (m ? m[1] : text).trim();
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error("Pas de JSON dans la réponse.");
  return JSON.parse(s.slice(start, Math.max(s.lastIndexOf("}"), s.lastIndexOf("]")) + 1));
}
