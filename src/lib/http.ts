import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { QuotaError } from "./quota";
import { YouTubeError } from "./youtube/client";

// Identifiant anonyme (cookie) pour les limites par personne, en attendant de vrais comptes.
const UID = "yva_uid";

export async function userId(): Promise<string> {
  const jar = await cookies();
  let id = jar.get(UID)?.value;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    id = randomUUID();
    jar.set(UID, id, { httpOnly: true, sameSite: "lax", maxAge: 365 * 86400, path: "/" });
  }
  return id;
}

/** Erreurs connues → message clair ; le reste → message générique (le détail reste dans les journaux du serveur). */
export function fail(e: unknown) {
  if (e instanceof QuotaError) return NextResponse.json({ error: e.message, quota: e.scope }, { status: 429 });
  if (e instanceof YouTubeError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("[api]", e);
  return NextResponse.json({ error: "Une erreur est survenue. Réessaie dans un instant." }, { status: 500 });
}

export class UserError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
