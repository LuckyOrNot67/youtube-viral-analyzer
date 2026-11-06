import "server-only";
import { cached } from "./db";
import { UserError } from "./http";
import { ytdlp } from "./short";
import { CLIP_ID, urlClip } from "./sources";

// Twitch : les clips d'un streamer, c'est-à-dire les moments que ses viewers ont eux-mêmes découpés, triés par vues.
// Ce sont les meilleurs moments de ses streams, choisis par son public : on les monte en Shorts verticaux. Lus par
// yt-dlp, sans clé d'API. (La position de chaque clip dans la rediffusion demande l'API officielle de Twitch : à
// brancher avec une clé, pour pouvoir élargir un clip à tout le passage autour.)

export const LOGIN = /^[A-Za-z0-9_]{3,25}$/;

export type Periode = "24hr" | "7d" | "30d" | "all";
/** `ratio` : combien de fois le clip dépasse les vues habituelles des clips de la chaîne sur la période. */
export type Clip = { id: string; titre: string; duree: number; vues: number; date: number | null; image: string | null; ratio?: number };
export type Chaine = { login: string; nom: string; avatar: string | null; description: string | null; direct: { titre: string; image: string | null; spectateurs: number | null } | null };
export type Rediff = { id: string; titre: string; duree: number; vues: number; image: string | null };

type Entree = { url?: string; title?: string; duration?: number; view_count?: number; timestamp?: number; thumbnail?: string };

/** Les clips les plus vus d'un streamer sur la période (30 au plus), gardés 30 minutes. */
export async function clipsDe(login: string, periode: Periode): Promise<Clip[]> {
  if (!LOGIN.test(login)) throw new UserError("Nom de chaîne Twitch invalide.");
  const { value } = await cached(`twclips:${login.toLowerCase()}:${periode}`, 0.5, async () => {
    const { out, code, err } = await ytdlpJson(["--flat-playlist", "-j", "--playlist-end", "30", `https://www.twitch.tv/${login}/clips?filter=clips&range=${periode}`]);
    if (code !== 0 && !out.trim()) {
      if (/does not exist|not found|404/i.test(err)) throw new UserError(`La chaîne Twitch « ${login} » n'existe pas.`, 404);
      console.warn("[twitch] clips :", err.slice(-400));
      throw new UserError("Twitch ne répond pas pour le moment. Réessaie dans un instant.", 503);
    }
    const clips = out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entree).map(versClip).filter((c): c is Clip => c !== null)
      .sort((a, b) => b.vues - a.vues);
    // Les vues habituelles d'un clip de la chaîne : la médiane de la période.
    const mediane = clips.length ? clips[Math.floor(clips.length / 2)].vues : 0;
    return clips.map((c) => ({ ...c, ratio: mediane > 0 ? Math.round((c.vues / mediane) * 10) / 10 : undefined }));
  });
  return value;
}

/** La chaîne : son nom, sa photo et sa description (page publique de Twitch), et son direct en cours (vérifié toutes
 *  les 3 minutes). Pendant un direct, Twitch remplace la description par le titre du stream et le nombre de
 *  spectateurs : la fiche n'est gardée que 10 minutes. */
export async function chaineDe(login: string): Promise<Chaine> {
  if (!LOGIN.test(login)) throw new UserError("Nom de chaîne Twitch invalide.");
  const id = login.toLowerCase();
  const { value: fiche } = await cached(`twchaine:${id}`, 1 / 6, async () => {
    const html = await fetch(`https://www.twitch.tv/${id}`, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "fr-FR,fr" } }).then((r) => r.text()).catch(() => "");
    const meta = (p: string) => html.match(new RegExp(`<meta property="${p}" content="([^"]*)"`))?.[1]?.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') ?? null;
    const nom = meta("og:title")?.replace(/ - Twitch$/, "") ?? id;
    // La description sans la phrase générique ajoutée par Twitch.
    const description = meta("og:description")?.split(" — ")[0]?.trim() || null;
    const avatar = meta("og:image");
    const vus = description?.match(/pour ([\d\s\u00a0\u202f]+) ?(viewers|spectateurs)/i)?.[1].replace(/\D/g, "");
    return { nom, description: vus ? null : description, spectateurs: vus ? Number(vus) : null, avatar: avatar && !/twitch_logo|ttv-static-metadata/.test(avatar) ? avatar : null };
  });
  const { value: direct } = await cached(`twdirect:${id}`, 0.05, async () => {
    const { out } = await ytdlpJson(["-j", "--skip-download", `https://www.twitch.tv/${id}`]);
    if (!out.trim()) return null;
    const d = JSON.parse(out) as { is_live?: boolean; description?: string; title?: string; thumbnail?: string };
    return d.is_live ? { titre: d.description || d.title || "En direct", image: d.thumbnail?.replace("-0x0.", "-640x360.") ?? null } : null;
  });
  const { spectateurs, ...reste } = fiche;
  return { login: id, ...reste, direct: direct ? { ...direct, spectateurs } : null };
}

/** Les dernières rediffusions de la chaîne (12 au plus), gardées 1 h. */
export async function rediffsDe(login: string): Promise<Rediff[]> {
  if (!LOGIN.test(login)) throw new UserError("Nom de chaîne Twitch invalide.");
  const { value } = await cached(`twrediffs:${login.toLowerCase()}`, 1, async () => {
    const { out } = await ytdlpJson(["--flat-playlist", "-j", "--playlist-end", "12", `https://www.twitch.tv/${login}/videos?filter=archives&sort=time`]);
    return out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entree & { id?: string }).map((e) => ({
      id: e.id ?? "", titre: e.title ?? "Rediffusion", duree: Math.round(e.duration ?? 0), vues: e.view_count ?? 0, image: e.thumbnail && !/404_processing/.test(e.thumbnail) ? e.thumbnail.replace(/%\{width\}x%\{height\}/, "640x360") : null,
    })).filter((r) => r.id);
  });
  return value;
}

/** Un clip, par son identifiant dans l'app (« tc_… »), gardé 24 h. */
export async function clipDetail(id: string): Promise<Clip & { chaine: string | null }> {
  if (!CLIP_ID.test(id)) throw new UserError("Clip Twitch invalide.");
  const { value } = await cached(`twclip:${id}`, 24, async () => {
    const { out, err } = await ytdlpJson(["-j", "--skip-download", urlClip(id)]);
    if (!out.trim()) { console.warn("[twitch] clip :", err.slice(-400)); throw new UserError("Ce clip Twitch est introuvable.", 404); }
    const d = JSON.parse(out) as Entree & { channel?: string };
    return { ...(versClip({ ...d, url: urlClip(id) }) ?? { id, titre: "Clip Twitch", duree: 0, vues: 0, date: null, image: null }), chaine: d.channel ?? null };
  });
  return value;
}

function versClip(e: Entree): Clip | null {
  const slug = e.url?.split(/[/?#]/).filter(Boolean).at(-1);
  if (!slug || !e.duration) return null;
  return { id: `tc_${slug}`, titre: e.title ?? "Clip", duree: Math.round(e.duration), vues: e.view_count ?? 0, date: e.timestamp ? e.timestamp * 1000 : null, image: e.thumbnail ?? null };
}

const ytdlpJson = (args: string[]) => ytdlp(["--no-warnings", ...args]);
