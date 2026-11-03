import { NextResponse } from "next/server";
import { findExtraits } from "@/lib/ai/extraits";
import { videoDetail } from "@/lib/youtube/analyze";
import { cacheGet } from "@/lib/db";
import { assertUsage, countUsage } from "@/lib/quota";
import { fail, UserError, userId, VIDEO_ID } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!VIDEO_ID.test(id)) throw new UserError("Identifiant de vidéo invalide.");
    const uid = await userId();
    const fresh = cacheGet(`extraits:${id}`) === null;
    if (fresh) assertUsage(uid, "extraits");
    const { video } = await videoDetail(id);
    if (video.s.isShort) throw new UserError("C'est déjà un Short : la recherche d'extraits sert aux vidéos longues.");

    // Une ligne JSON par étape réelle ({"etape": …}), puis le résultat ({"resultat": …}) ou l'erreur ({"error": …}).
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctl) {
        const send = (o: unknown) => ctl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        try {
          const r = await findExtraits(video, (etape) => send({ etape }));
          if (fresh && r.source === "gemini") countUsage(uid, "extraits");
          send({ resultat: r });
        } catch (e) {
          send({ error: (await fail(e).json()).error });
        }
        ctl.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
