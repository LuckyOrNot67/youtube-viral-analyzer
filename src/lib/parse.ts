// Ce que la personne a collé dans le champ de recherche : une chaîne, une vidéo, ou un sujet.
// Pur (sans réseau) pour être testé.

export type Parsed =
  | { kind: "handle"; handle: string }
  | { kind: "channelId"; id: string }
  | { kind: "username"; name: string }
  | { kind: "video"; id: string }
  | { kind: "topic"; q: string }
  | { kind: "invalid"; reason: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^@[A-Za-z0-9._\-·]{3,30}$/;

export function parseInput(raw: string): Parsed {
  const s = raw.trim();
  if (!s) return { kind: "invalid", reason: "Colle une chaîne YouTube ou écris un sujet." };
  if (s.length > 200) return { kind: "invalid", reason: "C'est trop long pour une recherche." };
  if (HANDLE.test(s)) return { kind: "handle", handle: s };
  if (CHANNEL_ID.test(s)) return { kind: "channelId", id: s };

  const looksLikeUrl = /^(https?:\/\/)?([a-z0-9-]+\.)*(youtube\.com|youtu\.be)(\/|$)/i.test(s);
  if (!looksLikeUrl) {
    if (/^https?:\/\//i.test(s) || /^[\w-]+\.(com|fr|net|org|io|tv)(\/|$)/i.test(s)) return { kind: "invalid", reason: "Ce lien n'est pas un lien YouTube." };
    return { kind: "topic", q: s.replace(/\s+/g, " ") };
  }

  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); }
  catch { return { kind: "invalid", reason: "Ce lien YouTube est mal formé." }; }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (host === "youtu.be") return VIDEO_ID.test(parts[0] ?? "") ? { kind: "video", id: parts[0] } : bad();
  const v = url.searchParams.get("v");
  if (parts[0] === "watch") return v && VIDEO_ID.test(v) ? { kind: "video", id: v } : bad();
  if (["shorts", "live", "embed"].includes(parts[0] ?? "")) return VIDEO_ID.test(parts[1] ?? "") ? { kind: "video", id: parts[1] } : bad();
  if (parts[0]?.startsWith("@")) return HANDLE.test(parts[0]) ? { kind: "handle", handle: parts[0] } : bad();
  if (parts[0] === "channel") return CHANNEL_ID.test(parts[1] ?? "") ? { kind: "channelId", id: parts[1] } : bad();
  if (parts[0] === "user" && parts[1]) return { kind: "username", name: parts[1] };
  if (parts[0] === "c" && parts[1]) return { kind: "handle", handle: `@${parts[1]}` };
  if (parts[0] === "hashtag" && parts[1]) return { kind: "topic", q: `#${parts[1]}` };
  return bad();

  function bad(): Parsed { return { kind: "invalid", reason: "Je ne reconnais pas ce lien YouTube. Colle le lien d'une chaîne (youtube.com/@nom) ou d'une vidéo." }; }
}

/** Durée ISO 8601 de l'API (PT1H2M3S) en secondes. */
export function isoDuration(d: string): number {
  const m = d.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

/** Minutages écrits dans un commentaire (« 12:35 », « 1:02:10 »), en secondes. */
export function timestampsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/g)) {
    const h = Number(m[1] ?? 0), min = Number(m[2]), sec = Number(m[3]);
    if (sec < 60 && (m[1] === undefined || min < 60)) out.push(h * 3600 + min * 60 + sec);
  }
  return out;
}

export const fmtTime = (s: number) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
