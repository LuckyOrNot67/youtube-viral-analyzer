import { NextResponse } from "next/server";
import { videoDetail } from "@/lib/youtube/analyze";
import { fail, UserError, VIDEO_ID } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!VIDEO_ID.test(id)) throw new UserError("Identifiant de vidéo invalide.");
    return NextResponse.json(await videoDetail(id));
  } catch (e) {
    return fail(e);
  }
}
