import "server-only";
import { db } from "../db";
import { assertQuota, spend, type Bucket } from "../quota";
import { isoDuration } from "../parse";
import type { Snapshot } from "../score";
import type { Channel, Video } from "../types";

// API YouTube Data v3 : uniquement des lectures publiques avec une clé API (pas de connexion de l'utilisateur).
// Coûts officiels : 1 unité par lecture (jusqu'à 50 éléments), search.list dans un compteur séparé de 100 / jour.
const API = "https://www.googleapis.com/youtube/v3";

export class YouTubeError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export const hasYouTubeKey = () => Boolean(process.env.YOUTUBE_API_KEY);

async function call<T>(endpoint: string, params: Record<string, string | number | undefined>, bucket: Bucket = "unites"): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new YouTubeError("Clé YouTube manquante : ajoute YOUTUBE_API_KEY dans .env.local (voir .env.example).", 503);
  assertQuota(bucket, 1);
  const qs = new URLSearchParams({ key });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const res = await fetch(`${API}/${endpoint}?${qs}`, { cache: "no-store" });
  spend(bucket, 1, endpoint);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = body.error?.errors?.[0]?.reason ?? "";
    // Les messages d'erreur de Google peuvent contenir la requête : on ne les renvoie pas tels quels.
    console.warn(`[youtube] ${endpoint} ${res.status} ${reason}`);
    if (reason === "quotaExceeded" || reason === "rateLimitExceeded") throw new YouTubeError("Le quota YouTube de l'app est épuisé pour aujourd'hui. Réessaie demain.", 429);
    if (reason === "commentsDisabled") throw new YouTubeError("Les commentaires sont désactivés sur cette vidéo.", 404);
    if (res.status === 400 && /key/i.test(body.error?.message ?? "")) throw new YouTubeError("La clé YouTube est refusée. Vérifie YOUTUBE_API_KEY.", 503);
    if (res.status === 403) throw new YouTubeError("YouTube refuse l'accès à ces données.", 403);
    if (res.status === 404) throw new YouTubeError("Introuvable sur YouTube.", 404);
    throw new YouTubeError("YouTube ne répond pas correctement. Réessaie dans un instant.");
  }
  return res.json() as Promise<T>;
}

type Thumbs = Record<string, { url: string; width?: number }>;
const bestThumb = (t?: Thumbs) => t?.maxres?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? "";

type ChannelItem = {
  id: string;
  snippet: { title: string; description: string; customUrl?: string; thumbnails: Thumbs; country?: string };
  statistics: { subscriberCount?: string; hiddenSubscriberCount: boolean; videoCount: string };
  contentDetails: { relatedPlaylists: { uploads: string } };
};

const toChannel = (c: ChannelItem): Channel => ({
  id: c.id,
  title: c.snippet.title,
  handle: c.snippet.customUrl ?? null,
  avatar: bestThumb(c.snippet.thumbnails),
  description: c.snippet.description,
  subs: c.statistics.hiddenSubscriberCount || c.statistics.subscriberCount === undefined ? null : Number(c.statistics.subscriberCount),
  videoCount: Number(c.statistics.videoCount),
  uploads: c.contentDetails.relatedPlaylists.uploads,
  country: c.snippet.country ?? null,
});

const CHANNEL_PARTS = "snippet,statistics,contentDetails";

export async function channelBy(by: { handle?: string; id?: string; username?: string }): Promise<Channel> {
  const r = await call<{ items?: ChannelItem[] }>("channels", { part: CHANNEL_PARTS, forHandle: by.handle, id: by.id, forUsername: by.username });
  const c = r.items?.[0];
  if (!c) throw new YouTubeError("Cette chaîne n'existe pas ou n'est plus disponible.", 404);
  return toChannel(c);
}

/** Plusieurs chaînes en un appel par lot de 50. */
export async function channelsByIds(ids: string[]): Promise<Map<string, Channel>> {
  const out = new Map<string, Channel>();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await call<{ items?: ChannelItem[] }>("channels", { part: CHANNEL_PARTS, id: ids.slice(i, i + 50).join(","), maxResults: 50 });
    for (const c of r.items ?? []) out.set(c.id, toChannel(c));
  }
  return out;
}

/** Identifiants des dernières vidéos publiées (playlist des mises en ligne), par pages de 50. */
export async function uploadIds(uploads: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < n) {
    const r = await call<{ items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>("playlistItems", {
      part: "contentDetails", playlistId: uploads, maxResults: 50, pageToken,
    }).catch((e) => { if (e instanceof YouTubeError && e.status === 404) return { items: [], nextPageToken: undefined }; throw e; });
    ids.push(...(r.items ?? []).map((i) => i.contentDetails.videoId));
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return ids.slice(0, n);
}

type VideoItem = {
  id: string;
  snippet: { channelId: string; channelTitle: string; title: string; description: string; publishedAt: string; thumbnails: Thumbs; liveBroadcastContent?: string; defaultAudioLanguage?: string; defaultLanguage?: string };
  contentDetails: { duration: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
};

/** Statistiques par lots de 50 (1 unité par lot). Enregistre un relevé pour mesurer la vitesse plus tard. */
export async function videosByIds(ids: string[]): Promise<Video[]> {
  const out: Video[] = [];
  const now = Date.now();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await call<{ items?: VideoItem[] }>("videos", { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(","), maxResults: 50 });
    for (const v of r.items ?? []) {
      if (v.snippet.liveBroadcastContent === "live" || v.snippet.liveBroadcastContent === "upcoming") continue;
      if (v.statistics.viewCount === undefined) continue;
      out.push({
        id: v.id, channelId: v.snippet.channelId, channelTitle: v.snippet.channelTitle, title: v.snippet.title,
        description: v.snippet.description.slice(0, 1500), thumb: bestThumb(v.snippet.thumbnails), publishedAt: v.snippet.publishedAt,
        duration: isoDuration(v.contentDetails.duration), views: Number(v.statistics.viewCount),
        likes: v.statistics.likeCount === undefined ? null : Number(v.statistics.likeCount),
        comments: v.statistics.commentCount === undefined ? null : Number(v.statistics.commentCount),
        lang: (v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage ?? null)?.toLowerCase() ?? null,
        fetchedAt: now,
      });
    }
  }
  recordSnapshots(out);
  return out;
}

export type SearchFilters = {
  periode?: "24h" | "7j" | "30j" | "90j" | "tout";
  duree?: "toutes" | "shorts" | "longues";
  /** « fr » (par défaut) : seulement les vidéos en français ; « toutes » : aucun tri par langue. */
  langue?: "fr" | "toutes";
};

const PERIODE_JOURS = { "24h": 1, "7j": 7, "30j": 30, "90j": 90 } as const;

/** Recherche par sujet ou hashtag : un appel search.list (compteur des 100 / jour) pour 50 vidéos. */
export async function searchVideoIds(q: string, f: SearchFilters, pageToken?: string): Promise<{ ids: string[]; next?: string; total: number }> {
  const after = f.periode && f.periode !== "tout" ? new Date(Date.now() - PERIODE_JOURS[f.periode] * 86400_000).toISOString() : undefined;
  const r = await call<{ items?: { id: { videoId?: string } }[]; nextPageToken?: string; pageInfo?: { totalResults?: number } }>("search", {
    part: "id", type: "video", q, maxResults: 50, publishedAfter: after, pageToken,
    // Trier par vues renvoie presque uniquement des vidéos étrangères (mesuré : 0 sur 50 en français pour « #minecraft »).
    // Par pertinence, YouTube tient compte de la langue (31 sur 50) ; notre score fait ensuite le classement.
    order: f.langue === "toutes" ? "viewCount" : "relevance",
    // L'API classe en « short » (< 4 min), « medium » (4-20 min), « long » (> 20 min) : on affine ensuite sur la vraie durée.
    videoDuration: f.duree === "shorts" ? "short" : undefined,
    relevanceLanguage: f.langue === "toutes" ? undefined : "fr", regionCode: f.langue === "toutes" ? undefined : "FR", safeSearch: "moderate",
  }, "recherches");
  return { ids: [...new Set((r.items ?? []).map((i) => i.id.videoId).filter((x): x is string => Boolean(x)))], next: r.nextPageToken, total: r.pageInfo?.totalResults ?? 0 };
}

export type RawComment = { text: string; likes: number; at: string; replies: number };

/** Commentaires les plus pertinents (100 par appel, 1 unité), plafonnés. */
export async function topComments(videoId: string, max: number): Promise<RawComment[]> {
  const out: RawComment[] = [];
  let pageToken: string | undefined;
  while (out.length < max) {
    const r = await call<{ items?: { snippet: { totalReplyCount: number; topLevelComment: { snippet: { textOriginal: string; likeCount: number; publishedAt: string } } } }[]; nextPageToken?: string }>("commentThreads", {
      part: "snippet", videoId, maxResults: 100, order: "relevance", textFormat: "plainText", pageToken,
    });
    for (const t of r.items ?? []) {
      const s = t.snippet.topLevelComment.snippet;
      out.push({ text: s.textOriginal.slice(0, 600), likes: s.likeCount, at: s.publishedAt, replies: t.snippet.totalReplyCount });
    }
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out.slice(0, max);
}

// ===== Relevés successifs (pour la vitesse réelle), gardés 30 jours au plus =====
function recordSnapshots(vs: Video[]) {
  const ins = db().prepare("INSERT OR IGNORE INTO snapshots (video, at, views, likes, comments) VALUES (?, ?, ?, ?, ?)");
  const last = db().prepare("SELECT MAX(at) AS at FROM snapshots WHERE video = ?");
  for (const v of vs) {
    const l = (last.get(v.id) as { at: number | null } | undefined)?.at ?? 0;
    if (v.fetchedAt - l >= 3 * 3600_000) ins.run(v.id, v.fetchedAt, v.views, v.likes, v.comments);
  }
}

export function snapshotsOf(ids: string[]): Map<string, Snapshot[]> {
  const out = new Map<string, Snapshot[]>();
  const q = db().prepare("SELECT at, views FROM snapshots WHERE video = ? ORDER BY at");
  for (const id of ids) out.set(id, q.all(id) as Snapshot[]);
  return out;
}
