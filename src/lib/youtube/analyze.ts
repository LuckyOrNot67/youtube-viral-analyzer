import "server-only";
import { cached, purge } from "../db";
import { parseInput, type Parsed } from "../parse";
import { rank, scoreVideo, SHORT_MAX } from "../score";
import type { Channel, ScoredVideo, SearchResult, Video } from "../types";
import { channelBy, channelsByIds, searchVideoIds, snapshotsOf, uploadIds, videosByIds, YouTubeError, type SearchFilters } from "./client";
import LIMITES from "@/config/limites.json";

// Assemble les appels YouTube, le cache et le score. Ordre économe : on résout la chaîne, on lit sa playlist
// de mises en ligne par pages de 50, puis les statistiques par lots de 50. Jamais une recherche par vidéo.

const H = LIMITES.cache;
/** Base de comparaison d'une chaîne vue depuis une recherche par sujet : ses 50 dernières vidéos. */
const BASE_N = 50;

async function resolveChannel(p: Extract<Parsed, { kind: "handle" | "channelId" | "username" }>): Promise<Channel> {
  const key = p.kind === "handle" ? `ch:h:${p.handle.toLowerCase()}` : p.kind === "channelId" ? `ch:id:${p.id}` : `ch:u:${p.name.toLowerCase()}`;
  const { value } = await cached(key, H.chaineHeures, () =>
    channelBy(p.kind === "handle" ? { handle: p.handle } : p.kind === "channelId" ? { id: p.id } : { username: p.name }));
  return value;
}

async function channelVideos(ch: Channel, n: number): Promise<{ videos: Video[]; hit: boolean }> {
  const { value, hit } = await cached(`vids:${ch.id}:${n}`, H.videoHeures, async () => videosByIds(await uploadIds(ch.uploads, n)));
  return { videos: value, hit };
}

function scoreAll(videos: Video[], pools: Map<string, Video[]>, subs: Map<string, number | null>): ScoredVideo[] {
  const now = Date.now();
  const snaps = snapshotsOf(videos.map((v) => v.id));
  return rank(videos.map((v) => {
    const pool = pools.get(v.channelId) ?? [v];
    const s = scoreVideo(v, pool.some((p) => p.id === v.id) ? pool : [...pool, v], { now, snaps: snaps.get(v.id), subs: subs.get(v.channelId) ?? null });
    return { ...v, s, subs: subs.get(v.channelId) ?? null };
  }));
}

export async function analyzeChannel(p: Extract<Parsed, { kind: "handle" | "channelId" | "username" }>, n: number, query: string): Promise<SearchResult> {
  purge();
  const ch = await resolveChannel(p);
  const { videos, hit } = await channelVideos(ch, n);
  if (!videos.length) throw new YouTubeError("Cette chaîne n'a aucune vidéo publique.", 404);
  const scored = scoreAll(videos, new Map([[ch.id, videos]]), new Map([[ch.id, ch.subs]]));
  return {
    type: "chaine", query, channel: ch, videos: scored, cache: hit, fetchedAt: Math.min(...videos.map((v) => v.fetchedAt)),
    portee: videos.length < ch.videoCount
      ? `${videos.length} dernières vidéos analysées sur ${ch.videoCount.toLocaleString("fr-FR")} publiées`
      : `Les ${videos.length} vidéos publiques de la chaîne`,
  };
}

export async function analyzeTopic(q: string, f: SearchFilters): Promise<SearchResult> {
  purge();
  const fk = `${f.periode ?? "tout"}:${f.duree ?? "toutes"}:${f.langue ?? "fr"}`;
  const ids = await cached(`sujet:${q.toLowerCase()}:${fk}`, H.sujetHeures, async () => (await searchVideoIds(q, f)).ids);
  const { value: videos } = await cached(`sujet-stats:${q.toLowerCase()}:${fk}`, H.videoHeures, () => videosByIds(ids.value));
  const kept = videos.filter((v) => (f.duree === "shorts" ? v.duration <= SHORT_MAX : f.duree === "longues" ? v.duration > SHORT_MAX : true));
  if (!kept.length) throw new YouTubeError("Aucune vidéo trouvée pour ce sujet avec ces filtres.", 404);

  // Chaque vidéo est comparée aux 50 dernières vidéos de SA chaîne (mise en cache 24 h, partagée entre recherches).
  const chIds = [...new Set(kept.map((v) => v.channelId))];
  const { value: chans } = await cached(`chs:${chIds.sort().join(",")}`, H.chaineHeures, async () => [...(await channelsByIds(chIds)).values()]);
  const pools = new Map<string, Video[]>();
  // Par groupes de 10 chaînes en parallèle : ~3 s au lieu de ~25 s pour 50 chaînes, sans rafale d'appels.
  for (let i = 0; i < chans.length; i += 10) {
    await Promise.all(chans.slice(i, i + 10).map(async (ch) => {
      const { value } = await cached(`base:${ch.id}`, 24, async () => videosByIds(await uploadIds(ch.uploads, BASE_N)));
      pools.set(ch.id, value);
    }));
  }
  const scored = scoreAll(kept, pools, new Map(chans.map((c) => [c.id, c.subs])));
  return {
    type: "sujet", query: q, channel: null, videos: scored, cache: ids.hit, fetchedAt: Math.min(...kept.map((v) => v.fetchedAt)),
    portee: `${kept.length} vidéos parmi les plus vues que YouTube renvoie pour « ${q} ». Ce n'est pas l'inventaire complet du sujet.`,
  };
}

export type VideoDetail = { video: ScoredVideo; channel: Channel; voisines: ScoredVideo[] };

/** Une vidéo seule, comparée aux 50 dernières de sa chaîne. */
export async function videoDetail(id: string): Promise<VideoDetail> {
  const { value: vs } = await cached(`v:${id}`, H.videoHeures, () => videosByIds([id]));
  const v = vs[0];
  if (!v) throw new YouTubeError("Cette vidéo n'existe pas, est privée ou a été supprimée.", 404);
  const ch = await resolveChannel({ kind: "channelId", id: v.channelId });
  const { value: base } = await cached(`base:${ch.id}`, 24, async () => videosByIds(await uploadIds(ch.uploads, BASE_N)));
  const pool = base.some((b) => b.id === v.id) ? base.map((b) => (b.id === v.id ? v : b)) : [...base, v];
  const scored = scoreAll(pool, new Map([[ch.id, pool]]), new Map([[ch.id, ch.subs]]));
  const me = scored.find((s) => s.id === v.id)!;
  return { video: me, channel: ch, voisines: scored.filter((s) => s.id !== v.id && s.s.isShort === me.s.isShort).slice(0, 6) };
}

export { parseInput };
