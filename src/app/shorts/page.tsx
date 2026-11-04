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

/** Les Shorts créés ces 7 derniers jours. Après, ils sont effacés : il faut refaire l'analyse de la vidéo. */
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
    <div className="col" style={{ gap: 14, paddingTop: 16 }}>
      <div className="col" style={{ gap: 4 }}>
        <h1 className="h h-l">Mes Shorts</h1>
        <p className="sub">Gardés 7 jours. Après, il faut refaire l&apos;analyse de la vidéo.</p>
      </div>
      {!items && <div className="skeleton" style={{ height: 200 }} />}
      {items?.length === 0 && <p className="sub">Pas encore de Short. Ouvre une vidéo longue et clique sur « Trouver les Shorts ».</p>}
      {items?.map((x) => (
        <div key={x.id} className="card" style={{ gap: 12 }}>
          <div className="export">
            {x.etat === "pret" && x.fichier
              ? <video src={`/api/short/${x.id}?fichier=1`} controls playsInline preload="metadata" />
              : <div className="row small" style={{ aspectRatio: "9 / 16", borderRadius: 18, background: "var(--btn-2)", justifyContent: "center", padding: 12, textAlign: "center" }}>
                  {x.etat === "erreur" ? x.erreur : x.etat === "pret" ? "Fichier effacé" : <><Loader2 size={16} className="spin" /> Création…</>}
                </div>}
            <div className="col" style={{ gap: 8, minWidth: 0 }}>
              <b style={{ fontSize: 16, lineHeight: 1.25 }}>{x.titre || "Short"}</b>
              <Link href={`/video/${x.videoId}`} className="small">{x.videoTitre} · {fmtDur(x.start)} → {fmtDur(x.end)}</Link>
              <span className="small">{x.cadrage === "centre" ? "Plein écran" : "Image entière"} · encore {joursRestants(x.expireLe)} j</span>
              {x.etat === "pret" && x.fichier && <a className="btn sm" href={`/api/short/${x.id}?fichier=1&telecharger=1`} download><Download size={16} /> Télécharger</a>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
