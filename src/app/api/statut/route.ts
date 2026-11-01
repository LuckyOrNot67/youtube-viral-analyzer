import { NextResponse } from "next/server";
import { quotaStatus, usageSummary } from "@/lib/quota";
import { hasYouTubeKey } from "@/lib/youtube/client";
import { hasClaude, hasGemini } from "@/lib/ai/models";
import { hasDownloader } from "@/lib/short";
import { userId } from "@/lib/http";

export const runtime = "nodejs";

/** Ce qui est branché, le quota du jour (estimation interne) et les limites de la personne. */
export async function GET() {
  return NextResponse.json({
    services: { youtube: hasYouTubeKey(), gemini: hasGemini(), claude: hasClaude(), export: hasDownloader() },
    quota: quotaStatus(),
    usage: usageSummary(await userId()),
  });
}
