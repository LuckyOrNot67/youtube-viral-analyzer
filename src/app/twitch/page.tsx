"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { fmtNum } from "@/components/bits";
import { Source } from "@/components/Source";

// Twitch → TikTok : on tape une chaîne, on voit ses clips les plus vus (les moments que son public a lui-même
// découpés) et on les monte en Shorts verticaux, la webcam en haut. Sous la recherche, des chaînes à essayer,
// présentées comme sur Twitch (photo, en direct).

const CHAINES = ["zerator", "kamet0", "antoinedaniellive", "gotaga", "mistermv", "domingo"];
type Fiche = { login: string; nom: string; avatar: string | null; direct: { titre: string; spectateurs: number | null } | null };

/** « zerator », « twitch.tv/zerator » ou un lien complet : le nom de la chaîne. */
const nomDe = (v: string) => v.trim().replace(/^https?:\/\//, "").replace(/^(www\.|m\.)?twitch\.tv\//, "").split(/[/?#]/)[0];

export default function TwitchAccueil() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [fiches, setFiches] = useState<Record<string, Fiche>>({});
  useEffect(() => {
    CHAINES.forEach((c) => fetch(`/api/twitch/${c}?fiche=1`).then((r) => r.json()).then((j) => j.chaine && setFiches((f) => ({ ...f, [c]: j.chaine }))).catch(() => {}));
  }, []);
  const go = () => {
    const nom = nomDe(q);
    if (!/^[A-Za-z0-9_]{3,25}$/.test(nom)) { setErr("Tape le nom d'une chaîne Twitch (par exemple zerator) ou colle son lien."); return; }
    router.push(`/twitch/${nom.toLowerCase()}`);
  };
  // Les chaînes en direct d'abord.
  const ordre = [...CHAINES].sort((a, b) => Number(Boolean(fiches[b]?.direct)) - Number(Boolean(fiches[a]?.direct)));
  return (
    <section className="hero tw-page">
      <Source actif="twitch" />
      <div className="tw-hero">
        <span className="mono" style={{ color: "rgba(255,255,255,.75)" }}>• Twitch → TikTok, Reels, Shorts</span>
        <h1 className="h h-xl">Tes meilleurs moments de stream, <span className="it">en Shorts.</span></h1>
        <p>Tape ta chaîne. Tu vois les clips que ton public a le plus regardés, et tu les sors en vertical : ta webcam en haut, le jeu en dessous, les sous-titres au milieu.</p>
        <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <Search size={20} aria-hidden style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input id="twitch-q" value={q} onChange={(e) => { setQ(e.target.value); setErr(null); }} autoFocus enterKeyHint="search"
            placeholder="Ta chaîne Twitch ou son lien" aria-label="Chaîne Twitch" autoComplete="off" />
          <button className="btn tw-btn" type="submit" disabled={!q.trim()} aria-label="Voir les clips">
            <span className="lbl">Voir les clips</span> <span className="arrow"><ArrowUpRight size={18} strokeWidth={2.4} /></span>
          </button>
        </form>
        {err && <p className="error-text" role="alert" style={{ color: "#fff" }}>{err}</p>}
      </div>

      <div className="sec-head"><h2 className="h h-s">Chaînes à <span className="it tw-acc">essayer</span></h2></div>
      <div className="tw-chaines">
        {ordre.map((c) => {
          const f = fiches[c];
          return (
            <Link key={c} href={`/twitch/${c}`} className="tw-chaine">
              <span className={`tw-avatar sm${f?.direct ? " live" : ""}`}>{f?.avatar ? <img src={f.avatar} alt="" referrerPolicy="no-referrer" /> : <span>{c.slice(0, 1).toUpperCase()}</span>}</span>
              <span className="col" style={{ gap: 2, minWidth: 0 }}>
                <b>{f?.nom ?? c}</b>
                <span className="small">{f?.direct ? <><b className="tw-rouge">● En direct</b>{f.direct.spectateurs ? ` · ${fmtNum(f.direct.spectateurs)}` : ""}</> : "Voir ses clips"}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="feats">
        <div className="feat f2 tw"><img src="/3d/flame.webp" alt="" /><b>Choisis par ton public</b><span>Les clips les plus vus, et combien ils dépassent les autres</span></div>
        <div className="feat f1"><img src="/3d/scissors.webp" alt="" /><b>Webcam en haut</b><span>Repérée toute seule, le jeu en dessous</span></div>
        <div className="feat f3"><img src="/3d/play.webp" alt="" /><b>Sous-titres animés</b><span>Écrits par l&apos;IA, mot par mot</span></div>
      </div>
    </section>
  );
}
