import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { analyzeChannel, analyzeTopic, parseInput, videoDetail } from "@/lib/youtube/analyze";
import { assertUsage, countUsage } from "@/lib/quota";
import { fail, UserError, userId } from "@/lib/http";
import LIMITES from "@/config/limites.json";

export const runtime = "nodejs";

const Body = z.object({
  q: z.string().max(200),
  n: z.number().int().optional(),
  periode: z.enum(["24h", "7j", "30j", "90j", "tout"]).optional(),
  duree: z.enum(["toutes", "shorts", "longues"]).optional(),
  langue: z.enum(["fr", "toutes"]).optional(),
});

export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new UserError("Recherche invalide.");
    const { q, periode, duree, langue } = body.data;
    const n = LIMITES.videosParChaine.includes(body.data.n ?? 0) ? body.data.n! : 200;
    const uid = await userId();
    const p = parseInput(q);
    if (p.kind === "invalid") throw new UserError(p.reason);

    if (p.kind === "video") {
      // Un lien de vidéo : on renvoie vers sa fiche (comparée à sa chaîne).
      const d = await videoDetail(p.id);
      return NextResponse.json({ redirect: `/video/${d.video.id}` });
    }
    if (p.kind === "topic") {
      assertUsage(uid, "recherches");
      const r = await analyzeTopic(p.q, { periode: periode ?? "7j", duree: duree ?? "toutes", langue: langue ?? "fr" });
      if (!r.cache) countUsage(uid, "recherches"); // une recherche déjà en cache ne coûte rien : on ne la décompte pas
      return NextResponse.json(r);
    }
    assertUsage(uid, "recherches");
    const r = await analyzeChannel(p, n, q.trim());
    if (!r.cache) countUsage(uid, "recherches");
    return NextResponse.json(r);
  } catch (e) {
    return fail(e);
  }
}
