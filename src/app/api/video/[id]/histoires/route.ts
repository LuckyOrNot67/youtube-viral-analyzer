import { NextResponse } from "next/server";
import { cacheGet } from "@/lib/db";
import { findHistoires, type HistoiresResult } from "@/lib/ai/histoires";
import { videoDetail } from "@/lib/youtube/analyze";
import { coutVideo, histoiresPayees, payerHistoires } from "@/lib/analyses";
import { assertUsage, countUsage, formule } from "@/lib/quota";
import { fail, UserError, userId, VIDEO_ID } from "@/lib/http";
import LIMITES from "@/config/limites.json";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Les histoires complètes d'une vidéo, à découper en parties. Compte 1 sur le compteur histoires ; rouvrir est gratuit. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!VIDEO_ID.test(id)) throw new UserError("Identifiant de vidéo invalide.");
    const uid = await userId();
    const { video } = await videoDetail(id);
    if (video.s.isShort) throw new UserError("C'est déjà un Short : le découpage en histoires sert aux vidéos longues.");
    const deja = cacheGet<HistoiresResult>(`histoires:${id}`);
    const paye = deja ? histoiresPayees(uid, id, deja.creeLe) : false;
    const cout = coutVideo(video.duration);
    if (!paye) assertUsage(uid, "histoires", cout);

    const r = await findHistoires(video);
    // On ne fait payer que si l'IA a trouvé au moins une histoire.
    if (!histoiresPayees(uid, id, r.creeLe) && r.histoires.length) {
      payerHistoires(uid, id);
      countUsage(uid, "histoires", cout);
    }
    return NextResponse.json({ ...r, durees: LIMITES.histoires.durees, formule: { nom: formule().nom } });
  } catch (e) {
    return fail(e);
  }
}
