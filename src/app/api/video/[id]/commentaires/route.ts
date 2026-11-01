import { NextResponse } from "next/server";
import { analyzeComments } from "@/lib/ai/comments";
import { videoDetail } from "@/lib/youtube/analyze";
import { cacheGet } from "@/lib/db";
import { assertUsage, countUsage } from "@/lib/quota";
import { fail, UserError, userId, VIDEO_ID } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!VIDEO_ID.test(id)) throw new UserError("Identifiant de vidéo invalide.");
    const uid = await userId();
    const fresh = cacheGet(`com-ia:${id}`) === null;
    if (fresh) assertUsage(uid, "commentaires");
    const { video } = await videoDetail(id);
    const r = await analyzeComments(video);
    if (fresh) countUsage(uid, "commentaires");
    return NextResponse.json(r);
  } catch (e) {
    return fail(e);
  }
}
