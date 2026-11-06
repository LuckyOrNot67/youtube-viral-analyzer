import { NextResponse } from "next/server";
import { fail, UserError } from "@/lib/http";
import { clipsDe, type Periode } from "@/lib/twitch";

export const runtime = "nodejs";

const PERIODES: Periode[] = ["24hr", "7d", "30d", "all"];

/** Les clips les plus vus d'un streamer Twitch sur la période demandée (7 jours par défaut). */
export async function GET(req: Request, { params }: { params: Promise<{ login: string }> }) {
  try {
    const { login } = await params;
    const p = new URL(req.url).searchParams.get("periode") ?? "7d";
    if (!PERIODES.includes(p as Periode)) throw new UserError("Période invalide.");
    return NextResponse.json({ login, clips: await clipsDe(login, p as Periode) });
  } catch (e) {
    return fail(e);
  }
}
