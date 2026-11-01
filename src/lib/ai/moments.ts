// Moments cités dans les commentaires (« 12:35 ! ») : pur, pour être testé.
// C'est la preuve que des spectateurs ont remarqué ce passage, sans rien inventer.
import { timestampsIn } from "../parse.ts";

export type CommentLike = { text: string; likes: number };
export type Moment = { t: number; n: number; likes: number; exemples: string[] };

/** Regroupe les minutages proches (à 15 s près), classés par nombre de citations puis par likes. */
export function citedMoments(comments: CommentLike[], duration: number, max = 8): Moment[] {
  const hits: { t: number; likes: number; text: string }[] = [];
  for (const c of comments) {
    const ts = new Set(timestampsIn(c.text));
    // Un commentaire avec plus de 3 minutages est un sommaire des chapitres, pas une réaction à un moment.
    if (ts.size > 3) continue;
    for (const t of ts) if (t > 0 && (!duration || t < duration)) hits.push({ t, likes: c.likes, text: c.text });
  }
  hits.sort((a, b) => a.t - b.t);
  const groups: { ts: number[]; likes: number; texts: { text: string; likes: number }[] }[] = [];
  for (const h of hits) {
    const g = groups[groups.length - 1];
    if (g && h.t - g.ts[g.ts.length - 1] <= 15) { g.ts.push(h.t); g.likes += h.likes; g.texts.push(h); }
    else groups.push({ ts: [h.t], likes: h.likes, texts: [h] });
  }
  return groups
    .map((g) => ({
      t: Math.min(...g.ts), n: g.ts.length, likes: g.likes,
      exemples: [...g.texts].sort((a, b) => b.likes - a.likes).slice(0, 2).map((x) => x.text.replace(/\s+/g, " ").slice(0, 160)),
    }))
    .sort((a, b) => b.n - a.n || b.likes - a.likes)
    .slice(0, max);
}

/** Nombre de citations qui tombent dans un passage (avec 5 s de marge avant). */
export const citationsIn = (moments: Moment[], start: number, end: number) =>
  moments.filter((m) => m.t >= start - 5 && m.t <= end).reduce((s, m) => s + m.n, 0);
