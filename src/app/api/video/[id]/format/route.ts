import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { choisir } from "@/lib/format";
import { fail, UserError, userId, VIDEO_ID } from "@/lib/http";

export const runtime = "nodejs";

/** Le format de sortie choisi pour les Shorts ou pour les histoires de cette vidéo. Définitif : un second choix ne change rien. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!VIDEO_ID.test(id)) throw new UserError("Identifiant de vidéo invalide.");
    const b = z.object({ sorte: z.enum(["shorts", "histoires"]), format: z.enum(["vertical", "horizontal"]) }).safeParse(await req.json().catch(() => null));
    if (!b.success) throw new UserError("Format invalide.");
    return NextResponse.json({ choix: choisir(await userId(), id, b.data.sorte, b.data.format) });
  } catch (e) {
    return fail(e);
  }
}
