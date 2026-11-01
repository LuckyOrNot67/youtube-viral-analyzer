import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Journal des événements et des coûts (prototype) : une ligne JSON par événement dans .cache/events.jsonl.
const FILE = path.join(process.cwd(), ".cache", "events.jsonl");

export type LoggedEvent = { name: string; uid: string; props?: Record<string, unknown>; t: number };

export async function logEvent(e: LoggedEvent) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await appendFile(FILE, JSON.stringify(e) + "\n");
}

/** Coût d'un appel (IA, rendu) rattaché à une vidéo, côté serveur. */
export function logCost(projet: string, service: string, props: Record<string, unknown>) {
  logEvent({ name: "cout", uid: "serveur", props: { projet, service, ...props }, t: Date.now() }).catch(() => {});
}
