import { findExtraits } from "@/lib/ai/extraits";
import { videoDetail } from "@/lib/youtube/analyze";
import { analyseDe, attribuerLot, coutVideo, lotDe, passagesDe } from "@/lib/analyses";
import { assertUsage, countUsage, formule } from "@/lib/quota";
import { fail, UserError, userId, VIDEO_ID } from "@/lib/http";
import LIMITES from "@/config/limites.json";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!VIDEO_ID.test(id)) throw new UserError("Identifiant de vidéo invalide.");
    const uid = await userId();
    const { video } = await videoDetail(id);
    if (video.s.isShort) throw new UserError("C'est déjà un Short : la recherche d'extraits sert aux vidéos longues.");
    // Rouvrir une vidéo déjà analysée par la personne (moins de 7 jours) ne coûte rien.
    const deja = analyseDe(id);
    const lotConnu = deja ? lotDe(uid, id, deja.creeLe) : null;
    const cout = coutVideo(video.duration);
    if (lotConnu === null) assertUsage(uid, "videos", cout);

    // Une ligne JSON par étape réelle ({"etape": …}), puis le résultat ({"resultat": …}) ou l'erreur ({"error": …}).
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctl) {
        // La personne peut fermer la page en route : on continue (l'analyse est gardée) sans rien envoyer.
        let ouvert = true;
        const send = (o: unknown) => { if (ouvert) try { ctl.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { ouvert = false; } };
        try {
          const r = await findExtraits(video, (etape) => send({ etape }));
          let extraits = r.extraits;
          if (r.source === "gemini") {
            let lot = lotDe(uid, id, r.creeLe);
            if (lot === null) {
              lot = attribuerLot(uid, id, r.creeLe);
              countUsage(uid, "videos", cout);
            }
            extraits = passagesDe(uid, id, r, lot);
          }
          const { nom, shortsParVideo } = formule();
          send({ resultat: { ...r, extraits, formule: { nom, shortsParVideo }, expireLe: r.creeLe + LIMITES.analyse.conservationJours * 86400_000 } });
        } catch (e) {
          send({ error: (await fail(e).json()).error });
        }
        if (ouvert) try { ctl.close(); } catch {}
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
