import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { logCost } from "./events";

// Clés dans .env.local uniquement, jamais envoyées au navigateur.
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
const GEMINI_FALLBACKS = ["gemini-3.5-flash", "gemini-3.8-flash"];

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

/** Gemini regarde une vidéo YouTube publique à partir de son lien (aucun téléchargement de notre côté).
 *  Un modèle saturé ou trop lent passe la main au suivant. */
export async function geminiWatchYouTube(videoId: string, prompt: string, projet: string, timeoutMs = 240_000): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const uri = `https://www.youtube.com/watch?v=${videoId}`;
  let last: unknown;
  for (const model of [GEMINI_MODEL, ...GEMINI_FALLBACKS.filter((m) => m !== GEMINI_MODEL)]) {
    const t0 = Date.now();
    try {
      const res = await ai.interactions.create({
        model,
        input: [{ type: "video", uri }, { type: "text", text: prompt }],
        generation_config: { thinking_level: "low" },
      }, { timeout_ms: timeoutMs });
      const out = res.output_text?.trim();
      if (!out) throw new Error("Gemini n'a rien répondu.");
      logCost(projet, "gemini", { modele: model, ms: Date.now() - t0, usage: (res as { usage?: unknown }).usage ?? null });
      return out;
    } catch (e) {
      last = e;
      const status = (e as { status?: number }).status;
      console.warn(`[gemini] ${model} : ${status ?? (e as Error).message}`);
      if (status && status !== 503 && status !== 429 && status !== 500) throw e;
    }
  }
  throw last;
}

/** Premier bloc JSON d'un texte (Gemini l'entoure parfois de ```json). */
export function jsonIn(text: string): unknown {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = (m ? m[1] : text).trim();
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error("Pas de JSON dans la réponse.");
  return JSON.parse(s.slice(start, Math.max(s.lastIndexOf("}"), s.lastIndexOf("]")) + 1));
}
