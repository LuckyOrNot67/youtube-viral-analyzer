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
    const r = await findExtraits(video);
    if (fresh && r.source === "gemini") countUsage(uid, "extraits");
    return NextResponse.json(r);
  } catch (e) {
    return fail(e);
  }
}
