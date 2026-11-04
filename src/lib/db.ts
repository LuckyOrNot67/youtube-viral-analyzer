import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import LIMITES from "@/config/limites.json";

// Base locale SQLite (incluse dans Node, aucun compte à créer) dans .cache/data.db.
// Mêmes tables que la future base PostgreSQL : on changera le pilote, pas la logique.
const FILE = path.join(process.cwd(), ".cache", "data.db");

// Changer SCHEMA quand on ajoute une table : la connexion déjà ouverte (serveur de dev) recrée alors les tables.
const SCHEMA = 3;
const g = globalThis as unknown as { __yvaDb?: DatabaseSync; __yvaSchema?: number };

export function db(): DatabaseSync {
  if (g.__yvaDb && g.__yvaSchema === SCHEMA) return g.__yvaDb;
  mkdirSync(path.dirname(FILE), { recursive: true });
  const d = g.__yvaDb ?? new DatabaseSync(FILE);
  d.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS quota (day TEXT NOT NULL, bucket TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (day, bucket));
    CREATE TABLE IF NOT EXISTS quota_log (t INTEGER NOT NULL, endpoint TEXT NOT NULL, cost INTEGER NOT NULL, bucket TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, user TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, user, kind));
    CREATE TABLE IF NOT EXISTS snapshots (video TEXT NOT NULL, at INTEGER NOT NULL, views INTEGER NOT NULL, likes INTEGER, comments INTEGER, PRIMARY KEY (video, at));
    CREATE INDEX IF NOT EXISTS snapshots_video ON snapshots (video, at);
    CREATE TABLE IF NOT EXISTS lots (video TEXT NOT NULL, user TEXT NOT NULL, lot INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (video, user));
    CREATE TABLE IF NOT EXISTS shorts (id TEXT PRIMARY KEY, user TEXT NOT NULL, video TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
      cadrage TEXT NOT NULL, titre TEXT NOT NULL, video_titre TEXT NOT NULL, etat TEXT NOT NULL, erreur TEXT, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS shorts_user ON shorts (user, at);
  `);
  // Colonnes ajoutées après coup (l'erreur « colonne déjà là » est normale).
  try { d.exec("ALTER TABLE shorts ADD COLUMN partie INTEGER"); } catch {}
  g.__yvaDb = d;
  g.__yvaSchema = SCHEMA;
  return d;
}

/** Jour du quota YouTube : il repart à zéro à minuit, heure du Pacifique. */
export const quotaDay = (t = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(t);

export function cacheGet<T>(key: string): T | null {
  const row = db().prepare("SELECT value, expires FROM cache WHERE key = ?").get(key) as { value: string; expires: number } | undefined;
  if (!row || row.expires < Date.now()) return null;
  return JSON.parse(row.value) as T;
}

export function cacheSet(key: string, value: unknown, hours: number) {
  db().prepare("INSERT OR REPLACE INTO cache (key, value, expires) VALUES (?, ?, ?)").run(key, JSON.stringify(value), Date.now() + hours * 3600_000);
}

/** Lit le cache, sinon calcule et enregistre. `hit` dit si la réponse venait du cache. */
export async function cached<T>(key: string, hours: number, fn: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return { value: hit, hit: true };
  const value = await fn();
  cacheSet(key, value, hours);
  return { value, hit: false };
}

/** Efface ce qui a expiré et les relevés de plus de 30 jours (règle de conservation des données YouTube). */
export function purge() {
  const now = Date.now();
  db().prepare("DELETE FROM cache WHERE expires < ?").run(now);
  db().prepare("DELETE FROM snapshots WHERE at < ?").run(now - 30 * 86400_000);
  db().prepare("DELETE FROM quota_log WHERE t < ?").run(now - 30 * 86400_000);
  // Analyses, lots et Shorts : gardés 7 jours, puis il faut refaire l'analyse.
  const garde = now - LIMITES.analyse.conservationJours * 86400_000;
  db().prepare("DELETE FROM lots WHERE at < ?").run(garde);
  db().prepare("DELETE FROM shorts WHERE at < ?").run(garde);
}
