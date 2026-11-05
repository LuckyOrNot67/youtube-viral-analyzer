import { cacheGet } from "@/lib/db";
import { findHistoires, type HistoiresResult } from "@/lib/ai/histoires";
import { videoDetail } from "@/lib/youtube/analyze";
import { coutVideo, histoiresPayees, payerHistoires } from "@/lib/analyses";
import { assertUsage, countUsage, formule } from "@/lib/quota";
import { fail, UserError, userId, VIDEO_ID } from "@/lib/http";
import { formatPour } from "@/lib/format";
import { GeminiSurcharge } from "@/lib/ai/models";
import { relancer } from "@/lib/relance";
import LIMITES from "@/config/limites.json";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Les histoires complètes d'une vidéo, à découper en parties. Compte 1 sur le compteur histoires ; rouvrir est gratuit. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!VIDEO_ID.test(id)) throw new UserError("Identifiant de vidéo invalide.");
    const uid = await userId();
    const { video } = await videoDetail(id);
    if (video.s.isShort) throw new UserError("C'est déjà un Short : le découpage en histoires sert aux vidéos longues.");
    const deja = cacheGet<HistoiresResult>(`histoires:${id}`);
    const paye = deja ? histoiresPayees(uid, id, deja.creeLe) : false;
    const cout = coutVideo(video.duration);
    if (!paye) assertUsage(uid, "histoires", cout);

    // L'IA met souvent plus de 100 s : le lien public coupe une réponse muette au-delà. On répond tout de suite
    // et on envoie une ligne JSON toutes les 15 s ({"attente": true}), puis le résultat ({"resultat": …}) ou l'erreur.
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctl) {
        let ouvert = true;
        const send = (o: unknown) => { if (ouvert) try { ctl.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { ouvert = false; } };
        const pouls = setInterval(() => send({ attente: true }), 15_000);
        try {
          const r = await findHistoires(video);
          // On ne fait payer que si l'IA a trouvé au moins une histoire.
          if (!histoiresPayees(uid, id, r.creeLe) && r.histoires.length) {
            payerHistoires(uid, id);
            countUsage(uid, "histoires", cout);
          }
          send({ resultat: { ...r, format: formatPour(uid, id, "histoires"), durees: LIMITES.histoires.durees, formule: { nom: formule().nom } } });
        } catch (e) {
          if (e instanceof GeminiSurcharge) { relancer("histoires", video); send({ surcharge: true }); }
          else send({ error: (await fail(e).json()).error });
        } finally {
          clearInterval(pouls);
        }
        if (ouvert) try { ctl.close(); } catch {}
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
