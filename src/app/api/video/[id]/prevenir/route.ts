import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { aPrevenir, relanceEnCours } from "@/lib/relance";
import { fail, UserError, VIDEO_ID } from "@/lib/http";

export const runtime = "nodejs";

/** « Préviens-moi » : l'email est gardé jusqu'à la fin de la relance automatique, puis effacé. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!VIDEO_ID.test(id)) throw new UserError("Identifiant de vidéo invalide.");
    const b = z.object({ email: z.email().max(200), sorte: z.enum(["shorts", "histoires"]) }).safeParse(await req.json().catch(() => null));
    if (!b.success) throw new UserError("Adresse email invalide.");
    // Plus de relance en cours : l'analyse est déjà prête (ou a abandonné), il suffit de recliquer.
    if (!relanceEnCours(b.data.sorte, id)) return NextResponse.json({ pret: true });
    aPrevenir(b.data.email.toLowerCase(), b.data.sorte, id, new URL(req.url).origin);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
