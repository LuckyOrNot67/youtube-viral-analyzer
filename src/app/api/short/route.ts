import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { hasDownloader, startShort } from "@/lib/short";
import { videoDetail } from "@/lib/youtube/analyze";
import { assertUsage, countUsage } from "@/lib/quota";
import { fail, UserError, userId, VIDEO_ID } from "@/lib/http";
import LIMITES from "@/config/limites.json";

export const runtime = "nodejs";

const Body = z.object({
  videoId: z.string().regex(VIDEO_ID),
  start: z.number().min(0),
  end: z.number().positive(),
  cadrage: z.enum(["centre", "entier"]),
});

export async function POST(req: Request) {
  try {
    const b = Body.safeParse(await req.json().catch(() => null));
    if (!b.success) throw new UserError("Demande d'export invalide.");
    const { videoId, cadrage } = b.data;
    const start = Math.round(b.data.start), end = Math.round(b.data.end);
    const len = end - start;
    if (len < LIMITES.short.dureeMin || len > LIMITES.short.dureeMax) throw new UserError(`Un Short doit durer entre ${LIMITES.short.dureeMin} et ${LIMITES.short.dureeMax} secondes.`);
    if (!hasDownloader()) throw new UserError("L'outil de téléchargement n'est pas installé sur le serveur (npm run setup).", 503);
    const { video } = await videoDetail(videoId);
    if (end > video.duration + 1) throw new UserError("Ce passage dépasse la fin de la vidéo.");
    const uid = await userId();
    assertUsage(uid, "shorts");
    const job = startShort({ videoId, start, end, cadrage, uid });
    if (job.etat === "attente") countUsage(uid, "shorts");
    return NextResponse.json({ id: job.id });
  } catch (e) {
    return fail(e);
  }
}
