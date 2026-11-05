import "server-only";
import { cached, cacheGet, cacheSet, db, purge } from "../db";
import { isFrench } from "../lang";
import { parseInput, type Parsed } from "../parse";
import { rank, scoreVideo, SHORT_MAX } from "../score";
import { couvre, motsDe, parleDe } from "../sujet";
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

/** Il faut au moins ça de vidéos du même format (Shorts ou longues) pour bien comparer. */
const COMPARAISON_MIN = 12;
const BASE_MAX = 200;

/** Les vidéos de la chaîne qui servent de point de comparaison : les 50 dernières. Si la chaîne mélange les formats
 *  et que l'un d'eux y est trop rare (Squeezie : 46 Shorts pour 4 longues), on remonte jusqu'à 200 vidéos. */
async function baseDe(ch: Channel): Promise<Video[]> {
  const { value } = await cached(`base2:${ch.id}`, 24, async () => {
    const ids = await uploadIds(ch.uploads, BASE_N);
    const vs = await videosByIds(ids);
    const shorts = vs.filter((v) => v.duration > 0 && v.duration <= SHORT_MAX).length, longues = vs.length - shorts;
    const rare = (n: number) => n > 0 && n < COMPARAISON_MIN;
    if (ids.length < BASE_N || (!rare(shorts) && !rare(longues))) return vs;
    const plus = (await uploadIds(ch.uploads, BASE_MAX)).filter((id) => !ids.includes(id));
    return [...vs, ...(await videosByIds(plus))];
  });
  return value;
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

/** Pages de recherche au plus (1 page = 50 vidéos = 1 des 100 recherches du jour, partagées par toute l'app). */
const MAX_PAGES = 2;
/** On arrête de chercher plus loin dès qu'on a assez de vidéos qui passent les filtres. */
const ASSEZ = 20;
/** Avec autant de vidéos déjà en mémoire (« ofm » pour « ofm life »), on ne relance pas YouTube. */
const SEUIL_REPRISE = 10;
/** Durée de vie de la liste d'une recherche (l'appel le plus rare) : une recherche « 24 h » vieillit vite.
 *  Les vues, elles, sont relues toutes les quelques heures pour 1 unité par lot de 50. */
const LISTE_HEURES = { "24h": 2, "7j": 12, "30j": 24, "90j": 48, tout: H.sujetHeures };

type Trouve = { videos: Video[]; chans: Channel[]; vues: number; reprises?: string[] };

/** Recherches encore en mémoire, avec les mêmes filtres, dont tous les mots font partie de la nouvelle. */
function recherchesQuiCouvrent(mots: string[], fk: string, saufCle: string): { q: string; t: Trouve }[] {
  const rows = db().prepare("SELECT key, value FROM cache WHERE key LIKE ? AND expires > ?").all(`sujet:%:${fk}`, Date.now()) as { key: string; value: string }[];
  return rows
    .filter((r) => r.key !== saufCle)
    .map((r) => ({ q: r.key.slice("sujet:".length, -(fk.length + 1)), t: JSON.parse(r.value) as Trouve }))
    .filter((r) => couvre(motsDe(r.q), mots));
}

export async function analyzeTopic(q: string, f: SearchFilters): Promise<SearchResult> {
  purge();
  const langue = f.langue ?? "fr";
  const periodeK = f.periode ?? "7j";
  const fk = `${periodeK}:${f.duree ?? "toutes"}:${langue}`;
  const mots = motsDe(q);
  const passes = (v: Video, chans: Map<string, Channel>) =>
    (f.duree === "shorts" ? v.duration <= SHORT_MAX : f.duree === "longues" ? v.duration > SHORT_MAX : true)
    && (langue !== "fr" || isFrench({ lang: v.lang, title: v.title, description: v.description, channelCountry: chans.get(v.channelId)?.country ?? null }))
    && parleDe(v, mots);

  const key = `sujet:${q.toLowerCase()}:${fk}`;
  let found = cacheGet<Trouve>(key);
  let cherche = false;
  if (!found) {
    // On part de ce qu'on sait déjà : « ofm » en mémoire fournit les vidéos qui parlent aussi de « life ».
    const videos: Video[] = [], chans = new Map<string, Channel>(), reprises: string[] = [];
    for (const a of recherchesQuiCouvrent(mots, fk, key)) {
      const utiles = a.t.videos.filter((v) => parleDe(v, mots) && !videos.some((x) => x.id === v.id));
      if (!utiles.length) continue;
      reprises.push(a.q);
      videos.push(...utiles);
      for (const c of a.t.chans) if (utiles.some((v) => v.channelId === c.id)) chans.set(c.id, c);
    }
    // Sinon, ou pas assez : recherche YouTube page par page, jusqu'à avoir assez de vidéos dans la bonne langue.
    // Avec une base déjà en mémoire, une seule page suffit à compléter (1 recherche au lieu de 3).
    const maxPages = videos.length ? 1 : MAX_PAGES;
    let next: string | undefined, pages = 0, vues = videos.length;
    while (videos.length < (pages === 0 ? SEUIL_REPRISE : ASSEZ) && pages < maxPages && (pages === 0 || next)) {
      const r = await searchVideoIds(q, f, next);
      cherche = true;
      pages++; next = r.next;
      const vs = await videosByIds(r.ids.filter((id) => !videos.some((v) => v.id === id)));
      vues += vs.length;
      const missing = [...new Set(vs.map((v) => v.channelId))].filter((id) => !chans.has(id));
      for (const [id, c] of await channelsByIds(missing)) chans.set(id, c);
      videos.push(...vs.filter((v) => passes(v, chans)));
    }
    found = { videos, chans: [...chans.values()].filter((c) => videos.some((v) => v.channelId === c.id)), vues, reprises };
    cacheSet(key, found, LISTE_HEURES[periodeK]);
  }

  // Liste gardée plus longtemps que les chiffres : on relit les vues si elles datent (1 unité par 50 vidéos).
  const vieilles = found.videos.filter((v) => Date.now() - v.fetchedAt > H.videoHeures * 3600_000);
  if (vieilles.length) {
    const frais = new Map((await videosByIds(vieilles.map((v) => v.id))).map((v) => [v.id, v]));
    found = { ...found, videos: found.videos.map((v) => frais.get(v.id) ?? v) };
    cacheSet(key, found, LISTE_HEURES[periodeK]);
  }

  // Les recherches gardées d'avant ce filtre peuvent encore contenir des vidéos hors sujet.
  const kept = found.videos.filter((v) => parleDe(v, mots));
  if (!kept.length) throw new YouTubeError(langue === "fr"
    ? `Aucune vidéo en français ne parle de « ${mots.join(" ")} » sur cette période. Essaie une période plus longue ou d'autres mots.`
    : `Aucune vidéo ne parle de « ${mots.join(" ")} » avec ces filtres.`, 404);

  // Chaque vidéo est comparée aux dernières vidéos de SA chaîne (voir baseDe, mises en cache 24 h, partagées entre recherches).
  const pools = new Map<string, Video[]>();
  // Par groupes de 10 chaînes en parallèle : ~3 s au lieu de ~25 s pour 50 chaînes, sans rafale d'appels.
  for (let i = 0; i < found.chans.length; i += 10) {
    await Promise.all(found.chans.slice(i, i + 10).map(async (ch) => {
      pools.set(ch.id, await baseDe(ch));
    }));
  }
  const scored = scoreAll(kept, pools, new Map(found.chans.map((c) => [c.id, c.subs])));
  const periode = { "24h": "des dernières 24 h", "7j": "des 7 derniers jours", "30j": "des 30 derniers jours", "90j": "des 90 derniers jours", tout: "" }[f.periode ?? "7j"];
  return {
    type: "sujet", query: q, channel: null, videos: scored, cache: !cherche, fetchedAt: Math.min(...kept.map((v) => v.fetchedAt)),
    portee: `${kept.length} vidéos ${langue === "fr" ? "en français " : ""}${periode} qui parlent de « ${mots.join(" ")} », parmi les ${found.vues} que YouTube renvoie`
      + `${found.reprises?.length ? ` (dont celles de ${found.reprises.map((r) => `« ${r} »`).join(", ")}, déjà cherché)` : ""}. Ce n'est pas l'inventaire complet du sujet.`,
  };
}

export type VideoDetail = { video: ScoredVideo; channel: Channel; voisines: ScoredVideo[] };

/** Une vidéo seule, comparée aux 50 dernières de sa chaîne. */
export async function videoDetail(id: string): Promise<VideoDetail> {
  const { value: vs } = await cached(`v:${id}`, H.videoHeures, () => videosByIds([id]));
  const v = vs[0];
  if (!v) throw new YouTubeError("Cette vidéo n'existe pas, est privée ou a été supprimée.", 404);
  const ch = await resolveChannel({ kind: "channelId", id: v.channelId });
  const base = await baseDe(ch);
  const pool = base.some((b) => b.id === v.id) ? base.map((b) => (b.id === v.id ? v : b)) : [...base, v];
  const scored = scoreAll(pool, new Map([[ch.id, pool]]), new Map([[ch.id, ch.subs]]));
  const me = scored.find((s) => s.id === v.id)!;
  return { video: me, channel: ch, voisines: scored.filter((s) => s.id !== v.id && s.s.isShort === me.s.isShort).slice(0, 6) };
}

export { parseInput };
