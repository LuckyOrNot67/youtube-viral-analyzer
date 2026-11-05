import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { choisir, verrouille } from "@/lib/format";
import { fail, UserError, userId, VIDEO_ID } from "@/lib/http";

export const runtime = "nodejs";

/** Le cadrage choisi pour les Shorts ou pour les histoires de cette vidéo. Modifiable tant que rien n'a été créé. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!VIDEO_ID.test(id)) throw new UserError("Identifiant de vidéo invalide.");
    const b = z.object({ sorte: z.enum(["shorts", "histoires"]), format: z.enum(["vertical", "bandes", "horizontal"]) }).safeParse(await req.json().catch(() => null));
    if (!b.success) throw new UserError("Format invalide.");
    const uid = await userId();
    return NextResponse.json({ choix: choisir(uid, id, b.data.sorte, b.data.format), verrouille: verrouille(uid, id, b.data.sorte) });
  } catch (e) {
    return fail(e);
  }
}
