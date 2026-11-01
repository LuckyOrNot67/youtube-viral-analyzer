import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { cached } from "../db";
import { topComments, type RawComment } from "../youtube/client";
import type { CommentsAnalysis, Video } from "../types";
import { claude, CLAUDE_MODEL, hasClaude } from "./models";
import { citedMoments } from "./moments";
import LIMITES from "@/config/limites.json";

// Analyse des commentaires d'UNE vidéo, à la demande (jamais en masse).

/** Commentaires bruts, gardés 24 h (≈ 3 unités de quota pour 300 commentaires). */
export const commentsOf = (videoId: string) =>
  cached(`com:${videoId}`, 24, () => topComments(videoId, LIMITES.commentairesMax)).then((r) => r.value);

const Schema = z.object({
  sujets: z.array(z.string()).describe("3 à 5 sujets dont les spectateurs parlent le plus, en quelques mots chacun"),
  questions: z.array(z.string()).describe("Jusqu'à 5 questions qui reviennent, reformulées simplement. Vide s'il n'y en a pas."),
  reactions: z.string().describe("Une ou deux phrases sur le ton général : ce qui plaît, ce qui agace."),
  idees: z.array(z.string()).describe("3 idées de Shorts tirées de ce que les spectateurs disent vouloir ou citer"),
});

export async function analyzeComments(v: Video): Promise<CommentsAnalysis> {
  const raw = await commentsOf(v.id);
  const moments = citedMoments(raw, v.duration);
  const base = { total: v.comments, lus: raw.length, moments };
  if (!raw.length) return { ...base, sujets: [], questions: [], reactions: "Aucun commentaire public à lire.", idees: [] };
  if (!hasClaude()) return { ...base, sujets: [], questions: [], reactions: "Analyse IA indisponible (clé Claude manquante).", idees: [] };

  const { value } = await cached(`com-ia:${v.id}`, 24, async () => {
    const res = await claude(v.id).messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: "Tu analyses des commentaires YouTube pour un créateur francophone qui cherche des idées de Shorts. Tu écris en français, simplement. Tu t'appuies UNIQUEMENT sur les commentaires fournis : aucune citation, aucun chiffre et aucun minutage inventés.",
      messages: [{ role: "user", content: `Vidéo : « ${v.title} » (${v.channelTitle}).\n\nCommentaires les plus pertinents (likes entre crochets) :\n${listing(raw)}` }],
      output_config: { format: zodOutputFormat(Schema) },
    });
    if (!res.parsed_output) throw new Error("Analyse des commentaires illisible.");
    return res.parsed_output;
  });
  return { ...base, ...value };
}

const listing = (raw: RawComment[]) =>
  [...raw].sort((a, b) => b.likes - a.likes).slice(0, 150).map((c) => `- [${c.likes}] ${c.text.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
