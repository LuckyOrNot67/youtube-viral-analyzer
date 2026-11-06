"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { fmtDur } from "@/components/bits";

type Item = {
  id: string; videoId: string; start: number; end: number; cadrage: "centre" | "entier";
  etat: "attente" | "telechargement" | "montage" | "pret" | "erreur"; erreur: string | null;
  titre: string; videoTitre: string; expireLe: number; fichier: boolean;
};

const joursRestants = (t: number) => Math.max(1, Math.ceil((t - Date.now()) / 86400_000));

/** Les Shorts créés ces 7 derniers jours, en grille. Après, ils sont effacés : il faut refaire l'analyse de la vidéo. */
export default function MesShorts() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/shorts").then((r) => r.json()).then((j: { shorts: Item[] }) => {
      if (stop) return;
      setItems(j.shorts);
      // Tant qu'un Short est en cours de création, on rafraîchit.
      if (j.shorts.some((x) => x.etat !== "pret" && x.etat !== "erreur")) setTimeout(load, 2000);
    }).catch(() => setErr("Impossible de charger tes Shorts."));
    load();
    return () => { stop = true; };
  }, []);

  if (err) return <div className="notice bad" role="alert" style={{ marginTop: 16 }}>{err}</div>;

  return (
    <div className="col" style={{ gap: 18, paddingTop: 24 }}>
      <div className="col" style={{ gap: 8 }}>
        <span className="mono dim">• {items ? `${items.length} Shorts` : "Ta galerie"}</span>
        <h1 className="h h-l">Mes <span className="it">Shorts.</span></h1>
        <p className="sub">Gardés 7 jours, prêts à poster. Après, il faut refaire l&apos;analyse de la vidéo.</p>
      </div>
      {!items && <div className="gallery">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ aspectRatio: "9 / 16" }} />)}</div>}
      {items?.length === 0 && <p className="sub">Pas encore de Short. Ouvre une vidéo longue et clique sur « Trouver les Shorts ».</p>}
      {items && items.length > 0 && (
        <div className="gallery">
          {items.map((x) => (
            <div key={x.id} className="tile">
              <div className="media">
                {x.etat === "pret" && x.fichier
                  ? <video src={`/api/short/${x.id}?fichier=1`} controls playsInline preload="metadata" />
                  : <div className="ph">{x.etat === "erreur" ? x.erreur : x.etat === "pret" ? "Fichier effacé" : <span className="row"><Loader2 size={16} className="spin" /> Création…</span>}</div>}
                <span className="days left">{joursRestants(x.expireLe)} j</span>
              </div>
              <div className="meta">
                <b>{x.titre || "Short"}</b>
                <Link href={x.videoId.startsWith("tc_") ? `https://clips.twitch.tv/${x.videoId.slice(3)}` : `/video/${x.videoId}`} className="small" style={{ display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{x.videoTitre}</Link>
                <span className="time dim">{fmtDur(x.start)} → {fmtDur(x.end)} · {x.cadrage === "centre" ? "plein écran" : "image entière"}</span>
              </div>
              {x.etat === "pret" && x.fichier && <a className="btn lime sm" href={`/api/short/${x.id}?fichier=1&telecharger=1`} download><Download size={15} /> Télécharger</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
