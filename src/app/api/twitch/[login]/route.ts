import { NextResponse } from "next/server";
import { fail, UserError } from "@/lib/http";
import { chaineDe, clipsDe, rediffsDe, type Periode } from "@/lib/twitch";

export const runtime = "nodejs";

const PERIODES: Periode[] = ["24hr", "7d", "30d", "all"];

/** Une chaîne Twitch : sa fiche (photo, direct en cours), ses clips les plus vus sur la période demandée (7 jours par
 *  défaut) et ses dernières rediffusions. */
export async function GET(req: Request, { params }: { params: Promise<{ login: string }> }) {
  try {
    const { login } = await params;
    const q = new URL(req.url).searchParams;
    // Seulement la fiche (photo, direct en cours) : pour les chaînes proposées sur l'accueil.
    if (q.get("fiche")) return NextResponse.json({ chaine: await chaineDe(login) });
    const p = q.get("periode") ?? "7d";
    if (!PERIODES.includes(p as Periode)) throw new UserError("Période invalide.");
    const [chaine, clips, rediffs] = await Promise.all([chaineDe(login), clipsDe(login, p as Periode), rediffsDe(login).catch(() => [])]);
    return NextResponse.json({ chaine, clips, rediffs });
  } catch (e) {
    return fail(e);
  }
}
