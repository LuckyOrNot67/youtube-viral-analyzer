import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileOf, getJob } from "@/lib/short";
import { userId } from "@/lib/http";

export const runtime = "nodejs";

/** État de l'export, ou le fichier MP4 avec ?fichier=1 (seulement pour la personne qui l'a demandé). */
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job: id } = await params;
  const job = getJob(id);
  if (!job || job.uid !== (await userId())) return NextResponse.json({ error: "Export introuvable ou expiré." }, { status: 404 });
  const url = new URL(req.url);
  if (!url.searchParams.has("fichier")) {
    const { etat, progression, erreur, start, end, cadrage, videoId } = job;
    return NextResponse.json({ etat, progression, erreur, start, end, cadrage, videoId });
  }
  if (job.etat !== "pret") return NextResponse.json({ error: "Le Short n'est pas encore prêt." }, { status: 409 });
  const s = await stat(fileOf(id)).catch(() => null);
  if (!s) return NextResponse.json({ error: "Le fichier a expiré." }, { status: 404 });
  const name = `short-${job.videoId}-${job.start}s.mp4`;
  return new Response(Readable.toWeb(createReadStream(fileOf(id))) as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4", "Content-Length": String(s.size),
      "Content-Disposition": `${url.searchParams.has("telecharger") ? "attachment" : "inline"}; filename="${name}"`,
    },
  });
}
