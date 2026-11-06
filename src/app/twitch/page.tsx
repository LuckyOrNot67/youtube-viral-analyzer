"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { Source } from "@/components/Source";

// Twitch → TikTok : on tape un streamer, on voit ses clips les plus vus (les moments que son public a lui-même
// découpés) et on les monte en Shorts verticaux, avec le même atelier que pour YouTube.

const EXEMPLES = ["zerator", "kamet0", "antoinedaniellive", "gotaga", "mistermv", "domingo"];

/** « zerator », « twitch.tv/zerator » ou un lien complet : le nom de la chaîne. */
const nomDe = (v: string) => v.trim().replace(/^https?:\/\//, "").replace(/^(www\.|m\.)?twitch\.tv\//, "").split(/[/?#]/)[0];

export default function TwitchAccueil() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = () => {
    const nom = nomDe(q);
    if (!/^[A-Za-z0-9_]{3,25}$/.test(nom)) { setErr("Tape le nom d'une chaîne Twitch (par exemple zerator) ou colle son lien."); return; }
    router.push(`/twitch/${nom.toLowerCase()}`);
  };
  return (
    <section className="hero">
      <Source actif="twitch" />
      <h1 className="h h-xl">Les meilleurs moments de ton stream, <span className="it tw-acc">en Shorts.</span></h1>
      <p className="sub" style={{ maxWidth: "44ch" }}>Une chaîne Twitch. Tu vois les clips que ton public a le plus regardés, et tu les sors en vertical pour TikTok, avec sous-titres et montage auto.</p>
      <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <Search size={20} aria-hidden style={{ color: "var(--muted)", flexShrink: 0 }} />
        <input id="twitch-q" value={q} onChange={(e) => { setQ(e.target.value); setErr(null); }} autoFocus enterKeyHint="search"
          placeholder="Une chaîne Twitch ou son lien" aria-label="Chaîne Twitch" autoComplete="off" />
        <button className="btn" type="submit" disabled={!q.trim()} aria-label="Voir les clips">
          <span className="lbl">Voir les clips</span> <span className="arrow"><ArrowUpRight size={18} strokeWidth={2.4} /></span>
        </button>
      </form>
      {err && <p className="error-text" role="alert">{err}</p>}
      <div className="scroll-x" aria-label="Exemples">
        {EXEMPLES.map((e) => <Link key={e} className="chip" href={`/twitch/${e}`}>{e}</Link>)}
      </div>
      <div className="feats">
        <div className="feat f2 tw"><img src="/3d/flame.webp" alt="" /><b>Choisis par ton public</b><span>Les clips les plus vus de ta chaîne</span></div>
        <div className="feat f1"><img src="/3d/scissors.webp" alt="" /><b>Montage auto</b><span>Le cadre passe sur celui qui parle</span></div>
        <div className="feat f3"><img src="/3d/play.webp" alt="" /><b>Sous-titres animés</b><span>Mot par mot, comme sur TikTok</span></div>
      </div>
    </section>
  );
}
