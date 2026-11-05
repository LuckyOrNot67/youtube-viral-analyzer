import "server-only";
import { cached } from "../db";
import { topComments } from "../youtube/client";
import LIMITES from "@/config/limites.json";

// Commentaires bruts d'une vidéo, lus sans IA : ils servent à repérer les moments que les spectateurs citent
// (« à 12:30 c'est trop drôle »). L'analyse des commentaires par Claude a été retirée (coût hors formule, peu utile).

/** Commentaires bruts, gardés 24 h (≈ 3 unités de quota pour 300 commentaires). */
export const commentsOf = (videoId: string) =>
  cached(`com:${videoId}`, 24, () => topComments(videoId, LIMITES.commentairesMax)).then((r) => r.value);
