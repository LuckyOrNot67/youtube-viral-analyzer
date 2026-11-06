"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, ExternalLink, Flame, Radio, Scissors, X } from "lucide-react";
import { fmtDur, fmtNum } from "@/components/bits";
import { ChoixRendu, ChoixSousTitres, Tuile, type Rendu, type SousTitres } from "@/components/atelier";
import { Source } from "@/components/Source";

// Page d'une chaîne Twitch, pensée comme Twitch : la bannière de la chaîne (photo, en direct), le direct en cours,
// puis les onglets Clips et Rediffusions. Les clips sont des cartes horizontales comme sur Twitch, avec leurs vues et
// combien de fois ils dépassent les clips habituels de la chaîne. « Créer » envoie le clip dans « Tes Shorts », au-dessus :
// les cartes ne bougent pas, le Short vertical se crée et se lit là-haut.

type Clip = { id: string; titre: string; duree: number; vues: number; date: number | null; image: string | null; ratio?: number };
type Chaine = { login: string; nom: string; avatar: string | null; description: string | null; direct: { titre: string; image: string | null; spectateurs: number | null } | null };
type Rediff = { id: string; titre: string; duree: number; vues: number; image: string | null };
type Periode = "24hr" | "7d" | "30d" | "all";
const PERIODES: { p: Periode; nom: string }[] = [
  { p: "24hr", nom: "24 h" },
  { p: "7d", nom: "7 jours" },
  { p: "30d", nom: "30 jours" },
  { p: "all", nom: "Depuis toujours" },
];

const ilYa = (ms: number | null) => {
  if (!ms) return "";
  const h = Math.round((Date.now() - ms) / 3600_000);
  return h < 24 ? `il y a ${Math.max(1, h)} h` : `il y a ${Math.round(h / 24)} j`;
};
const ratioTexte = (r: number) => `×${r.toFixed(r < 10 ? 1 : 0).replace(".", ",")}`;

export default function ChainePage() {
  const { login } = useParams<{ login: string }>();
  const [periode, setPeriode] = useState<Periode>("7d");
  const [chaine, setChaine] = useState<Chaine | null>(null);
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [rediffs, setRediffs] = useState<Rediff[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<"clips" | "rediffs">("clips");
  const [rendu, setRendu] = useState<Rendu>("auto");
  const [st, setSt] = useState<SousTitres>({ style: "classique", langue: "orig" });
  // Les Shorts demandés, du plus récent au plus ancien, avec les réglages du moment.
  const [shorts, setShorts] = useState<{ clip: Clip; rendu: Rendu; st: SousTitres }[]>([]);
  const [vu, setVu] = useState<Clip | null>(null);

  useEffect(() => {
    setClips(null); setErr(null);
    fetch(`/api/twitch/${login}?periode=${periode}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Erreur."); setChaine(j.chaine); setClips(j.clips); setRediffs(j.rediffs ?? []); })
      .catch((e) => setErr(e.message));
  }, [login, periode]);

  const nom = chaine?.nom ?? login;
  const creer = (c: Clip) => setShorts((s) => (s.some((x) => x.clip.id === c.id) ? s : [{ clip: c, rendu, st }, ...s]));

  return (
    <div className="vp tw-page">
      {vu && <ApercuClip clip={vu} onClose={() => setVu(null)} />}
      <Source actif="twitch" />

      <header className="tw-head">
        <div className="tw-banniere" aria-hidden />
        <div className="tw-id">
          <span className={`tw-avatar${chaine?.direct ? " live" : ""}`}>
            {chaine?.avatar ? <img src={chaine.avatar} alt="" referrerPolicy="no-referrer" /> : <span>{nom.slice(0, 1).toUpperCase()}</span>}
            {chaine?.direct && <span className="tw-live-pill">EN DIRECT</span>}
          </span>
          <div className="col" style={{ gap: 4, minWidth: 0 }}>
            <h1 className="tw-nom">{nom}</h1>
            <span className="small">{chaine?.direct
              ? <><b className="tw-rouge">En direct</b>{chaine.direct.spectateurs ? ` · ${fmtNum(chaine.direct.spectateurs)} spectateurs` : ""}</>
              : chaine?.description ?? "Chaîne Twitch"}</span>
          </div>
          <a className="btn ghost sm" href={`https://www.twitch.tv/${login}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Twitch</a>
        </div>
      </header>

      {chaine?.direct && (
        <a className="tw-direct" href={`https://www.twitch.tv/${login}`} target="_blank" rel="noreferrer">
          <span className="tw-direct-img">{chaine.direct.image && <img src={chaine.direct.image} alt="" referrerPolicy="no-referrer" />}<span className="tw-live-pill">EN DIRECT</span></span>
          <span className="col" style={{ gap: 6, minWidth: 0 }}>
            <b>{chaine.direct.titre}</b>
            <span className="small"><Radio size={13} /> Bientôt : les meilleurs moments du live, montés en Shorts pendant qu&apos;il tourne.</span>
          </span>
        </a>
      )}

      <div className="tw-onglets" role="tablist">
        <button role="tab" aria-selected={onglet === "clips"} className={onglet === "clips" ? "on" : ""} onClick={() => setOnglet("clips")}>Clips</button>
        <button role="tab" aria-selected={onglet === "rediffs"} className={onglet === "rediffs" ? "on" : ""} onClick={() => setOnglet("rediffs")}>Rediffusions{rediffs.length ? ` (${rediffs.length})` : ""}</button>
      </div>

      <div hidden={onglet !== "clips"} className="col" style={{ gap: 18 }}>
        <section className="tw-tes">
          <div className="sec-head"><h2 className="h h-s">Tes <span className="it tw-acc">Shorts</span></h2><span className="small">Gardés 7 jours dans <Link href="/shorts" style={{ textDecoration: "underline" }}>Mes Shorts</Link></span></div>
          {shorts.length === 0
            ? <p className="small">Clique sur « Créer le Short » sous un clip : sa version verticale se crée ici, avec la webcam en haut si le streamer en a une.</p>
            : (
              <div className="tw-plateau">
                {shorts.map(({ clip: c, rendu: r, st: s }) => (
                  <Tuile key={c.id} videoId={c.id} image={c.image} decale={50} actif={false} onVoir={() => setVu(c)}
                    haut={<span className="tc">{fmtNum(c.vues)} vues</span>} titre={c.titre} bas={<span className="tc">{fmtDur(c.duree)}</span>}
                    demande={{ start: 0, end: c.duree, titre: c.titre, rendu: r, sousTitres: s }} />
                ))}
              </div>
            )}
        </section>

        <details className="tw-reglages">
          <summary>Réglages du Short <span className="small">· {rendu === "auto" ? "Montage auto" : rendu === "vertical" ? "Short fixe" : "Horizontal"} · sous-titres {st.style === "aucun" ? "aucun" : st.style === "neon" ? "Néon" : st.style === "pop" ? "Pop" : "Classique"}</span></summary>
          <div className="col" style={{ gap: 14, marginTop: 12 }}>
            <ChoixRendu valeur={rendu} onChange={setRendu} image={clips?.find((c) => c.image)?.image ?? ""} />
            <ChoixSousTitres valeur={st} onChange={setSt} langueVideo={null} />
          </div>
        </details>

        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Période">
            {PERIODES.map((o) => <button key={o.p} role="radio" aria-checked={periode === o.p} className={`chip sm${periode === o.p ? " on" : ""}`} onClick={() => setPeriode(o.p)}>{o.nom}</button>)}
          </div>
          {clips && <span className="small">{clips.length} clips, du plus vu au moins vu</span>}
        </div>

        {err && <div className="notice bad" role="alert">{err}</div>}
        {!clips && !err && <div className="tw-grille">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" style={{ aspectRatio: "16/9" }} />)}</div>}
        {clips && !clips.length && <div className="panel"><b className="panel-t">Aucun clip sur cette période</b><p className="small">Essaie une période plus longue.</p></div>}
        {clips && clips.length > 0 && (
          <div className="tw-grille">
            {clips.map((c) => {
              const fait = shorts.some((x) => x.clip.id === c.id);
              return (
                <article key={c.id} className="tw-clip">
                  <button type="button" className="tw-vignette" onClick={() => setVu(c)} aria-label={`Voir le clip ${c.titre}`}>
                    {c.image && <img src={c.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                    <span className="tw-coin hg">{fmtNum(c.vues)} vues</span>
                    {c.ratio !== undefined && c.ratio >= 2 && <span className="tw-ratio"><Flame size={13} /> {ratioTexte(c.ratio)}</span>}
                    <span className="tw-coin bg">{fmtDur(c.duree)}</span>
                    {c.date && <span className="tw-coin bd">{ilYa(c.date)}</span>}
                  </button>
                  <b className="tw-titre">{c.titre}</b>
                  <button className={`btn sm${fait ? " ghost" : " tw-btn"}`} disabled={fait} onClick={() => creer(c)}>
                    {fait ? <><Check size={15} /> Dans tes Shorts</> : <><Scissors size={15} /> Créer le Short</>}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div hidden={onglet !== "rediffs"} className="col" style={{ gap: 14 }}>
        <div className="panel">
          <b className="panel-t">Bientôt : les meilleurs moments de chaque rediffusion</b>
          <p className="small">L&apos;IA repérera les passages forts d&apos;un stream entier (les pics du chat, les clips de ton public) pour en faire des Shorts. Il faut pour ça brancher l&apos;accès officiel à Twitch.</p>
        </div>
        <div className="tw-grille">
          {rediffs.map((r) => (
            <a key={r.id} className="tw-clip" href={`https://www.twitch.tv/videos/${r.id.replace(/^v/, "")}`} target="_blank" rel="noreferrer">
              <span className="tw-vignette">
                {r.image && <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <span className="tw-coin hg">{fmtNum(r.vues)} vues</span>
                <span className="tw-coin bg">{fmtDur(r.duree)}</span>
              </span>
              <b className="tw-titre">{r.titre}</b>
            </a>
          ))}
        </div>
      </div>
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
