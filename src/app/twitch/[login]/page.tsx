"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { fmtDur, fmtNum } from "@/components/bits";
import { ChoixRendu, ChoixSousTitres, Tuile, type Rendu, type SousTitres } from "@/components/atelier";
import { Source } from "@/components/Source";

// Page d'un streamer Twitch : ses clips les plus vus sur la période, en tuiles 9:16. Le rendu et les sous-titres se
// choisissent au-dessus ; chaque clip se crée dans sa tuile et se lit à sa place. Un clic sur une tuile lit le clip
// dans une fenêtre par-dessus la page.

type Clip = { id: string; titre: string; duree: number; vues: number; date: number | null; image: string | null };
type Periode = "24hr" | "7d" | "30d" | "all";
const PERIODES: { p: Periode; nom: string }[] = [
  { p: "24hr", nom: "24 h" },
  { p: "7d", nom: "7 jours" },
  { p: "30d", nom: "30 jours" },
  { p: "all", nom: "Toujours" },
];
const DECALAGES = [50, 30, 70, 40, 60];

const ilYa = (ms: number | null) => {
  if (!ms) return "";
  const h = Math.round((Date.now() - ms) / 3600_000);
  return h < 24 ? `il y a ${Math.max(1, h)} h` : `il y a ${Math.round(h / 24)} j`;
};

export default function StreamerPage() {
  const { login } = useParams<{ login: string }>();
  const [periode, setPeriode] = useState<Periode>("7d");
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rendu, setRendu] = useState<Rendu>("auto");
  const [st, setSt] = useState<SousTitres>({ style: "classique", langue: "orig" });
  // Ce qui a été choisi au moment de créer chaque clip (changer ensuite ne refait pas les Shorts lancés).
  const [demandes, setDemandes] = useState<Record<string, { rendu: Rendu; st: SousTitres }>>({});
  const [vu, setVu] = useState<Clip | null>(null);

  useEffect(() => {
    setClips(null); setErr(null);
    fetch(`/api/twitch/${login}?periode=${periode}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Erreur."); setClips(j.clips); })
      .catch((e) => setErr(e.message));
  }, [login, periode]);

  const image = clips?.find((c) => c.image)?.image ?? "";

  return (
    <div className="vp">
      {vu && <ApercuClip clip={vu} onClose={() => setVu(null)} />}
      <Source actif="twitch" />
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div className="col" style={{ gap: 4 }}>
          <h1 className="vp-title">Les clips de <span className="tw-acc">{login}</span></h1>
          <span className="small">Les moments que son public a découpés, du plus vu au moins vu.</span>
        </div>
        <a className="btn ghost sm" href={`https://www.twitch.tv/${login}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Sur Twitch</a>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Période">
        {PERIODES.map((o) => <button key={o.p} role="radio" aria-checked={periode === o.p} className={periode === o.p ? "on" : ""} onClick={() => setPeriode(o.p)}>{o.nom}</button>)}
      </div>

      <div className="cadrage">
        <ChoixRendu valeur={rendu} onChange={setRendu} image={image} />
        <p className="small">Vaut pour les prochains clips que tu crées.</p>
      </div>
      <ChoixSousTitres valeur={st} onChange={setSt} langueVideo={null} />

      {err && <div className="notice bad" role="alert">{err}</div>}
      {!clips && !err && <div className="tuiles">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ aspectRatio: "9/16" }} />)}</div>}
      {clips && !clips.length && <div className="panel"><b className="panel-t">Aucun clip sur cette période</b><p className="small">Essaie une période plus longue.</p></div>}
      {clips && clips.length > 0 && (
        <>
          <div className="sec-head"><h2 className="h h-m">{clips.length} <span className="it tw-acc">clips</span></h2><span className="small">Un Short par clip, gardé 7 jours dans <Link href="/shorts" style={{ textDecoration: "underline" }}>Mes Shorts</Link></span></div>
          <div className="tuiles">
            {clips.map((c, i) => (
              <Tuile key={c.id} videoId={c.id} image={c.image} decale={DECALAGES[i % DECALAGES.length]} actif={vu?.id === c.id} onVoir={() => setVu(c)}
                haut={<><span className="tc">{fmtNum(c.vues)} vues</span>{c.date && <span className="tc">{ilYa(c.date)}</span>}</>}
                titre={c.titre} bas={<span className="tc">{fmtDur(c.duree)}</span>}
                demande={demandes[c.id] ? { start: 0, end: c.duree, titre: c.titre, rendu: demandes[c.id].rendu, sousTitres: demandes[c.id].st } : null}
                onCreer={() => setDemandes({ ...demandes, [c.id]: { rendu, st } })} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Le clip lu dans une fenêtre par-dessus la page (lecteur de Twitch). Échap ou un clic à côté la ferme. */
function ApercuClip({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const [hote, setHote] = useState("");
  useEffect(() => {
    setHote(window.location.hostname);
    const touche = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", touche);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", touche); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="apercu" role="dialog" aria-modal="true" aria-label={clip.titre} onClick={onClose}>
      <div className="apercu-in" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="small" style={{ color: "#fff" }}>{clip.titre}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer" autoFocus><X size={18} /></button>
        </div>
        <div className="player">
          {hote && <iframe src={`https://clips.twitch.tv/embed?clip=${encodeURIComponent(clip.id.slice(3))}&parent=${hote}&autoplay=true`} title={clip.titre} allow="autoplay; fullscreen" allowFullScreen />}
        </div>
      </div>
    </div>
  );
}
