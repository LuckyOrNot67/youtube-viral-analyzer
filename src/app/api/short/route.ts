import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { exportesPour, hasDownloader, startShort } from "@/lib/short";
import { videoDetail } from "@/lib/youtube/analyze";
import { analyseDe, histoiresPayees, lotDe, passagesDe } from "@/lib/analyses";
import { cacheGet } from "@/lib/db";
import { cleHistoires, type HistoiresResult } from "@/lib/ai/histoires";
import type { Cadrage, InfosMontage, SousTitresDemande } from "@/lib/short";
import { motsDe, sousTitres } from "@/lib/sous-titres";
import { formule } from "@/lib/quota";
import { fail, UserError, userId, VIDEO_ID } from "@/lib/http";
import { cadrageDe } from "@/lib/format";
import { CLIP_ID, estClip } from "@/lib/sources";
import { clipDetail } from "@/lib/twitch";
import { transcrire } from "@/lib/ai/transcription";
import LIMITES from "@/config/limites.json";

export const runtime = "nodejs";

const Body = z.object({
  /** Une vidéo YouTube, ou un clip Twitch (« tc_… »). */
  videoId: z.string().refine((id) => VIDEO_ID.test(id) || CLIP_ID.test(id)),
  start: z.number().min(0),
  end: z.number().positive(),
  /** Ignoré : le cadrage vient du choix fait pour les Shorts ou les histoires de la vidéo, sinon du conseil de l'IA. */
  cadrage: z.enum(["centre", "entier", "horizontal", "bandes", "auto"]).optional(),
  titre: z.string().max(300).optional(),
  /** Une partie d'histoire : le numéro de la partie et l'histoire entière (pour vérifier que la partie en fait bien partie). */
  histoire: z.object({ partie: z.number().int().min(1), start: z.number().min(0), end: z.number().positive(), duree: z.number().int().positive().optional() }).optional(),
  /** Sous-titres animés mot par mot : le style, et la langue (celle de la vidéo, ou traduits en français). */
  sousTitres: z.object({ style: z.enum(["classique", "pop", "neon"]), langue: z.enum(["orig", "fr"]) }).optional(),
  /** Clip Twitch : le rendu choisi sur la page (pour YouTube, il est gardé par vidéo, voir format.ts). */
  rendu: z.enum(["auto", "vertical", "horizontal"]).optional(),
});

export async function POST(req: Request) {
  try {
    const b = Body.safeParse(await req.json().catch(() => null));
    if (!b.success) { console.warn("[short] demande invalide :", b.error.message); throw new UserError("Demande d'export invalide."); }
    const { videoId } = b.data;
    if (estClip(videoId)) return NextResponse.json({ id: await clipTwitch(b.data) });
    const start = Math.round(b.data.start), end = Math.round(b.data.end);
    const len = end - start, h = b.data.histoire;
    // Une partie peut reprendre quelques secondes de la précédente.
    const dureeMax = h ? LIMITES.histoires.partieMax + LIMITES.histoires.recul : LIMITES.short.dureeMax;
    if (len < LIMITES.short.dureeMin || len > dureeMax) throw new UserError(`${h ? "Une partie" : "Un Short"} doit durer entre ${LIMITES.short.dureeMin} et ${dureeMax} secondes.`);
    if (!hasDownloader()) throw new UserError("L'outil de téléchargement n'est pas installé sur le serveur (npm run setup).", 503);
    const { video } = await videoDetail(videoId);
    if (end > video.duration + 1) throw new UserError("Ce passage dépasse la fin de la vidéo.");
    const uid = await userId();
    // Le choix de la personne, sinon le cadrage conseillé par l'IA (jamais le plein écran par défaut s'il coupe l'essentiel).
    const choix = cadrageDe(uid, videoId, h ? "histoires" : "shorts");
    const cadrage: Cadrage = choix === "vertical" ? "centre" : choix;
    // Montage auto : les sous-titres aident Gemini à savoir qui parle (déjà gardés, pour trouver les passages).
    const montage: InfosMontage | undefined = cadrage === "auto" ? () => sousTitres(video) : undefined;
    const st: SousTitresDemande | undefined = b.data.sousTitres ? { ...b.data.sousTitres, mots: () => motsDe(video) } : undefined;

    if (h) return NextResponse.json({ id: partieHistoire(uid, video, { start, end, cadrage, titre: b.data.titre ?? "", h, montage, sousTitres: st }) });

    // Shorts inclus, plafonnés par vidéo selon la formule (les deux cadrages d'un même passage comptent pour un).
    const { nom, shortsParVideo } = formule();
    const faits = exportesPour(uid, videoId);
    if (!faits.some((p) => p.start === start && p.end === end) && faits.length >= shortsParVideo) {
      throw new UserError(`Ta formule ${nom} donne ${shortsParVideo} Shorts par vidéo, et tu les as tous créés pour celle-ci.`, 429);
    }
    // Les autres passages proposés à la personne seront téléchargés dans la foulée, en un seul appel.
    const a = analyseDe(videoId);
    const lot = a ? lotDe(uid, videoId, a.creeLe) : null;
    const autres = a && lot !== null ? passagesDe(uid, videoId, a, lot).map((x) => ({ start: x.start, end: x.end })) : [];

    const { job } = startShort({ videoId, start, end, cadrage, uid, titre: b.data.titre ?? "", videoTitre: video.title, autres, montage, sousTitres: st });
    return NextResponse.json({ id: job.id });
  } catch (e) {
    return fail(e);
  }
}

/** Une partie d'histoire : incluse dès que la vidéo a été découpée en histoires, sans plafond de Shorts. */
function partieHistoire(uid: string, video: { id: string; title: string }, o: { start: number; end: number; cadrage: Cadrage; titre: string; h: { partie: number; start: number; end: number; duree?: number }; montage?: InfosMontage; sousTitres?: SousTitresDemande }): string {
  // La découpe de la durée choisie, sinon n'importe laquelle encore gardée pour cette vidéo.
  const r = cacheGet<HistoiresResult>(cleHistoires(video.id));
  const histoire = r?.histoires.find((x) => Math.abs(x.start - o.h.start) <= 1 && Math.abs(x.end - o.h.end) <= 1);
  // La découpe régulière de secours (sans IA) n'est pas décomptée : ses parties sont libres.
  if (!r || !histoire || (!r.avertissement && !histoiresPayees(uid, video.id))) throw new UserError("Découpe d'abord cette vidéo en histoires (ou refais-le : c'est gardé 7 jours).");
  if (o.start < histoire.start - 1 || o.end > histoire.end + 1) throw new UserError("Cette partie sort de l'histoire.");
  const titre = `${o.titre || histoire.titre} · Partie ${o.h.partie}`;
  const { job } = startShort({ videoId: video.id, start: o.start, end: o.end, cadrage: o.cadrage, uid, titre, videoTitre: video.title, autres: [], partie: o.h.partie, montage: o.montage, sousTitres: o.sousTitres });
  return job.id;
}

/** Un clip Twitch entier, monté en Short : le rendu choisi, les sous-titres dictés par l'IA (pas de sous-titres sur
 *  Twitch). Un Short par clip. */
async function clipTwitch(d: z.infer<typeof Body>): Promise<string> {
  if (!hasDownloader()) throw new UserError("L'outil de téléchargement n'est pas installé sur le serveur (npm run setup).", 503);
  const clip = await clipDetail(d.videoId);
  if (clip.duree < 3) throw new UserError("Ce clip est trop court.");
  const uid = await userId();
  const cadrage: Cadrage = d.rendu === "vertical" ? "centre" : d.rendu ?? "auto";
  const st: SousTitresDemande | undefined = d.sousTitres ? {
    ...d.sousTitres,
    mots: ({ fichier, offset, len, start }) => transcrire(d.videoId, fichier, offset, len).then((ms) => ms.map((m) => ({ ...m, t: m.t + start, fin: m.fin + start }))),
  } : undefined;
  const { job } = startShort({ videoId: d.videoId, start: 0, end: clip.duree, cadrage, uid, titre: d.titre ?? clip.titre, videoTitre: clip.chaine ? `${clip.chaine} sur Twitch` : "Clip Twitch", autres: [], montage: cadrage === "auto" ? async () => [] : undefined, sousTitres: st });
  return job.id;
}
