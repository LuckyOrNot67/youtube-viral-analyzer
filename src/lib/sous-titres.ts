import "server-only";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { cacheGet, cacheSet } from "./db";
import { ytdlp } from "./short";
import type { Video } from "./types";

// Sous-titres YouTube d'une vidéo (ceux de la chaîne, sinon les automatiques), lus par yt-dlp sans télécharger la
// vidéo. Ils donnent le minutage de chaque bout de phrase : Gemini s'en sert pour couper les parties d'histoire pile
// en fin de phrase. Gardés 7 jours ; sans sous-titres, on fait sans (gardé 1 h, pour réessayer plus tard).

export type Phrase = { start: number; end: number; texte: string };

type Json3 = { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] };

export async function sousTitres(v: Video): Promise<Phrase[]> {
  const key = `st:${v.id}`;
  const deja = cacheGet<Phrase[]>(key);
  if (deja) return deja;
  const langue = (v.lang ?? "fr").slice(0, 2).toLowerCase();
  const dir = path.join(process.cwd(), ".cache", "st", v.id);
  let phrases: Phrase[] = [];
  try {
    await mkdir(dir, { recursive: true });
    // Seulement la langue d'origine : les traductions automatiques font vite refuser YouTube (erreur 429).
    await ytdlp(["-q", "--no-warnings", "--skip-download", "--write-subs", "--write-auto-subs",
      "--sub-langs", `${langue}-orig,${langue}`, "--sub-format", "json3",
      "-o", path.join(dir, "%(id)s.%(ext)s"), `https://www.youtube.com/watch?v=${v.id}`]);
    const fichiers = (await readdir(dir)).filter((f) => f.endsWith(".json3"));
    // Les sous-titres écrits par la chaîne d'abord, sinon les automatiques (« -orig »).
    const choisi = fichiers.find((f) => !f.includes("-orig")) ?? fichiers[0];
    if (choisi) phrases = lire(JSON.parse(await readFile(path.join(dir, choisi), "utf8")) as Json3);
  } catch (e) {
    console.warn("[sous-titres]", v.id, (e as Error).message);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  cacheSet(key, phrases, phrases.length ? 168 : 1);
  return phrases;
}

/** Les morceaux de texte avec leur début et leur fin (un morceau s'arrête au plus tard quand le suivant commence). */
function lire(j: Json3): Phrase[] {
  const ev = (j.events ?? [])
    .map((e) => ({ start: (e.tStartMs ?? 0) / 1000, end: ((e.tStartMs ?? 0) + (e.dDurationMs ?? 0)) / 1000, texte: (e.segs ?? []).map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim() }))
    .filter((e) => e.texte);
  return ev.map((e, i) => ({ ...e, end: Math.min(e.end, ev[i + 1]?.start ?? e.end) }));
}

/** Les sous-titres en lignes « [m:ss] texte » d'environ 10 s, pour les donner à lire à l'IA. */
export function enLignes(phrases: Phrase[]): string {
  const lignes: string[] = [];
  let debut = -1, texte = "";
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  for (const p of phrases) {
    if (debut < 0) debut = p.start;
    texte += (texte ? " " : "") + p.texte;
    if (p.end - debut >= 10) { lignes.push(`[${mmss(debut)}] ${texte}`); debut = -1; texte = ""; }
  }
  if (texte) lignes.push(`[${mmss(debut)}] ${texte}`);
  return lignes.join("\n");
}

/** La fin de morceau de texte la plus proche de `t` (à `ecart` secondes près), sinon `t`. */
export function finDePhrase(phrases: Phrase[], t: number, ecart = 2.5): number {
  let best = t, d = ecart;
  for (const p of phrases) if (Math.abs(p.end - t) <= d) { d = Math.abs(p.end - t); best = p.end; }
  return Math.round(best);
}

/** Le début de morceau de texte le plus proche de `t` (à `ecart` secondes près), sinon `t`. */
export function debutDePhrase(phrases: Phrase[], t: number, ecart = 1.5): number {
  let best = t, d = ecart;
  for (const p of phrases) if (Math.abs(p.start - t) <= d) { d = Math.abs(p.start - t); best = p.start; }
  return Math.round(best);
}
