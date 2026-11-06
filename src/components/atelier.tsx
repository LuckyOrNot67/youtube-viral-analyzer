"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Download, Loader2, Scissors } from "lucide-react";
import { Cover } from "@/components/Cover";

// L'atelier commun aux pages YouTube et Twitch : le choix du rendu et des sous-titres, et les tuiles 9:16 où chaque
// Short se crée puis se lit, sans rien faire bouger autour.

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({ error: "Réponse illisible." }));
  if (!r.ok) throw new Error(j.error ?? "Erreur.");
  return j as T;
}

/** Les trois rendus : montage par zones selon qui parle, le centre fixe, ou l'image entière. */
export type Rendu = "auto" | "vertical" | "horizontal";
const RENDUS: { f: Rendu; nom: string; dit: string }[] = [
  { f: "auto", nom: "Montage auto", dit: "Passe sur celui qui parle" },
  { f: "vertical", nom: "Short fixe", dit: "Le centre, sans montage" },
  { f: "horizontal", nom: "Horizontal", dit: "L'image entière" },
];

/** Les trois rendus côte à côte, chacun avec un petit écran d'aperçu sur une image de la vidéo. */
export function ChoixRendu({ valeur, onChange, fige, image }: { valeur: Rendu; onChange: (r: Rendu) => void; fige?: boolean; image: string }) {
  // Pas encore d'image (la liste charge) : l'écran d'aperçu reste noir.
  const img = (x: number) => (image ? <img src={image} alt="" referrerPolicy="no-referrer" style={{ objectPosition: `${Math.round(x * 100)}% 40%` }} /> : null);
  return (
    <div className="cadrage-opts" role="radiogroup" aria-label="Rendu">
      {RENDUS.map((o) => (
        <button key={o.f} type="button" role="radio" aria-checked={o.f === valeur} className={`cadrage-opt${o.f === valeur ? " on" : ""}`} disabled={fige && o.f !== valeur} onClick={() => onChange(o.f)}>
          <span className={`mini-tel ${o.f}`}>{o.f === "auto" ? <>{img(0.25)}{img(0.75)}</> : img(0.5)}</span>
          <span className="col" style={{ gap: 1 }}><b>{o.nom}</b><span className="small">{o.dit}</span></span>
        </button>
      ))}
    </div>
  );
}

/** Sous-titres animés mot par mot : un style (ou aucun), et la langue (celle de la vidéo, ou traduits en français). */
export type StyleST = "classique" | "pop" | "neon" | "aucun";
export type SousTitres = { style: StyleST; langue: "orig" | "fr" };
const STYLES: { s: StyleST; nom: string }[] = [
  { s: "classique", nom: "Classique" },
  { s: "pop", nom: "Pop" },
  { s: "neon", nom: "Néon" },
  { s: "aucun", nom: "Aucun" },
];

/** Le choix des sous-titres, avec un aperçu de chaque style. La langue n'est proposée que pour une vidéo étrangère. */
export function ChoixSousTitres({ valeur, onChange, langueVideo }: { valeur: SousTitres; onChange: (v: SousTitres) => void; langueVideo: string | null }) {
  const etrangere = Boolean(langueVideo) && !langueVideo!.toLowerCase().startsWith("fr");
  return (
    <div className="cadrage">
      <span className="small"><b style={{ color: "var(--text)" }}>Sous-titres</b> · mot par mot, comme sur TikTok</span>
      <div className="st-opts" role="radiogroup" aria-label="Sous-titres">
        {STYLES.map((o) => (
          <button key={o.s} type="button" role="radio" aria-checked={valeur.style === o.s} className={`st-opt${valeur.style === o.s ? " on" : ""}`} onClick={() => onChange({ ...valeur, style: o.s })}>
            <span className={`st-apercu ${o.s}`} aria-hidden>
              <span>
                {o.s === "classique" && <>C&apos;EST <i>LE</i> TALENT</>}
                {o.s === "pop" && <i>TALENT</i>}
                {o.s === "neon" && <>c&apos;est <i>le</i> talent</>}
                {o.s === "aucun" && <>—</>}
              </span>
            </span>
            <b>{o.nom}</b>
          </button>
        ))}
      </div>
      {etrangere && valeur.style !== "aucun" && (
        <div className="segmented" role="radiogroup" aria-label="Langue des sous-titres">
          <button role="radio" aria-checked={valeur.langue === "orig"} className={valeur.langue === "orig" ? "on" : ""} onClick={() => onChange({ ...valeur, langue: "orig" })}>Langue de la vidéo</button>
          <button role="radio" aria-checked={valeur.langue === "fr"} className={valeur.langue === "fr" ? "on" : ""} onClick={() => onChange({ ...valeur, langue: "fr" })}>Traduits en français</button>
        </div>
      )}
    </div>
  );
}

type Job = { etat: "attente" | "telechargement" | "montage" | "pret" | "erreur"; progression: number; erreur: string | null };
export type PartieDe = { partie: number; start: number; end: number; duree?: number };
/** Ce qu'il faut pour créer un Short : le passage, son titre, sa légende, et pour une partie d'histoire, l'histoire.
 *  `rendu` : pour un clip Twitch (pour YouTube, il est gardé par vidéo sur le serveur). */
export type Demande = { start: number; end: number; titre: string; legende?: string | null; histoire?: PartieDe; sousTitres?: SousTitres; rendu?: Rendu };

/** Une tuile 9:16 : la couverture, puis la création en cours par-dessus, puis la vidéo prête à sa place. Elle garde
 *  toujours la même taille : rien ne bouge autour. */
export function Tuile({ videoId, image, decale, haut, titre, bas, actif, onVoir, demande, attente, onCreer, onFin }: {
  videoId: string; image?: string | null; decale: number; haut: ReactNode; titre: ReactNode; bas: ReactNode; actif: boolean; onVoir: () => void;
  demande: Demande | null; attente?: boolean; onCreer?: () => void; onFin?: () => void;
}) {
  const couverture = <Cover videoId={videoId} image={image} decale={decale} actif={actif} onClick={onVoir} haut={haut} titre={titre} bas={bas} />;
  if (demande) return <Creation videoId={videoId} demande={demande} couverture={couverture} onFin={onFin} />;
  return (
    <div className="tuile">
      <div className="tuile-media">{couverture}</div>
      {attente
        ? <button className="btn sm ghost" disabled><Loader2 size={15} className="spin" /> En attente</button>
        : <button className="btn sm" onClick={onCreer}><Scissors size={15} /> Créer</button>}
    </div>
  );
}

/** Crée le Short dès l'ouverture et suit sa progression ; prêt, il se lit dans la tuile. */
function Creation({ videoId, demande, couverture, onFin }: { videoId: string; demande: Demande; couverture: ReactNode; onFin?: () => void }) {
  const [job, setJob] = useState<{ id: string; j: Job } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fini = !!err || job?.j.etat === "pret" || job?.j.etat === "erreur";
  // Prévient la file d'attente des parties : la suivante peut commencer.
  useEffect(() => { if (fini) onFin?.(); }, [fini]); // eslint-disable-line react-hooks/exhaustive-deps

  const { start, end, titre, histoire } = demande;
  const st = demande.sousTitres && demande.sousTitres.style !== "aucun" ? demande.sousTitres : undefined;
  useEffect(() => {
    setErr(null); setJob(null);
    api<{ id: string }>("/api/short", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, start, end, titre, histoire, sousTitres: st, rendu: demande.rendu }) })
      .then(({ id }) => setJob({ id, j: { etat: "attente", progression: 0, erreur: null } }))
      .catch((x) => setErr(x.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `histoire` est recréé à chaque rendu, ses valeurs sont start/end
  }, [videoId, start, end, titre]);

  useEffect(() => {
    if (!job || job.j.etat === "pret" || job.j.etat === "erreur") return;
    const t = setTimeout(() => {
      api<Job>(`/api/short/${job.id}`).then((j) => setJob({ id: job.id, j })).catch((x) => setErr(x.message));
    }, 1200);
    return () => clearTimeout(t);
  }, [job]);

  const fail = err ?? job?.j.erreur;
  if (job?.j.etat === "pret") {
    return (
      <div className="tuile">
        <div className="tuile-media"><video src={`/api/short/${job.id}?fichier=1`} controls playsInline preload="metadata" /></div>
        <div className="tuile-actions">
          <a className="btn sm lime" href={`/api/short/${job.id}?fichier=1&telecharger=1`} download><Download size={15} /> Télécharger</a>
          {demande.legende && <CopierLegende texte={demande.legende} />}
        </div>
      </div>
    );
  }
  const pct = Math.max(4, Math.round((job?.j.progression ?? 0) * 100));
  return (
    <div className="tuile">
      <div className="tuile-media">
        {couverture}
        <div className={`tuile-voile${fail ? " bad" : ""}`} role="status">
          {fail ? <span>{fail}</span> : <><Loader2 size={22} className="spin" /><span>{job?.j.etat === "telechargement" ? "Téléchargement…" : job?.j.etat === "montage" ? "Montage…" : "Préparation…"}</span><span className="bar"><span style={{ width: `${pct}%` }} /></span></>}
        </div>
      </div>
      <button className="btn sm ghost" disabled>{fail ? "Échec" : `${pct} %`}</button>
    </div>
  );
}

/** La légende à poster (description et hashtags), copiée d'un clic. */
function CopierLegende({ texte }: { texte: string }) {
  const [copie, setCopie] = useState(false);
  const copier = () => navigator.clipboard.writeText(texte).then(() => { setCopie(true); setTimeout(() => setCopie(false), 1500); }).catch(() => {});
  return <button className="btn sm ghost" onClick={copier} title={texte} aria-label="Copier la légende suggérée">{copie ? <Check size={15} /> : <Copy size={15} />} Légende</button>;
}

