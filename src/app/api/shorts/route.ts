import { NextResponse } from "next/server";
import { shortsDe } from "@/lib/short";
import { userId } from "@/lib/http";

export const runtime = "nodejs";

/** La galerie : les Shorts de la personne des 7 derniers jours. */
export async function GET() {
  return NextResponse.json({ shorts: shortsDe(await userId()) });
}
