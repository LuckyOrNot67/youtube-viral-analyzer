"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Flame } from "lucide-react";
import { SearchBox } from "@/components/SearchBox";
import { fmtAge, fmtDur, fmtNum, fmtScore, punch, ScoreBadge } from "@/components/bits";
import type { ScoredVideo, SearchResult } from "@/lib/types";

// Un seul choix à l'écran : le format. Le reste (français, 7 jours, 200 vidéos, tri par score) est réglé par défaut.
const FORMATS = [["toutes", "Tout"], ["longues", "Longues"], ["shorts", "Shorts"]] as const;

function Resultats() {
  const sp = useSearchParams();
  const router = useRouter();
  const q = sp.get("q") ?? "";
  const [res, setRes] = useState<SearchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [format, setFormat] = useState<string>("toutes");

  useEffect(() => {
    if (!q) return;
    let alive = true;
    setRes(null); setErr(null);
    fetch("/api/recherche", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }) })
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (j.redirect) router.replace(j.redirect);
        else if (!r.ok) setErr(j.error ?? "Erreur.");
        else setRes(j);
      })
      .catch(() => alive && setErr("Connexion impossible. Vérifie ton réseau."));
    return () => { alive = false; };
  }, [q, router]);

  const list = useMemo(() => (res?.videos ?? [])
    .filter((v) => (format === "shorts" ? v.s.isShort : format === "longues" ? !v.s.isShort : true))
    .sort((a, b) => b.s.score - a.s.score), [res, format]);

  const [top, ...rest] = list;
  const showChannel = res?.type === "sujet";

  return (
    <>
      <div style={{ paddingTop: 12 }}><SearchBox key={q} initial={q} /></div>

      {err && <div className="notice bad" role="alert">{err}</div>}
      {!res && !err && <Loading />}

      {res && (
        <>
          {res.channel ? (
            <div className="chan">
              {res.channel.avatar && <img referrerPolicy="no-referrer" src={res.channel.avatar} alt="" />}
              <div className="col" style={{ gap: 2 }}>
                <h1 className="h h-m">{res.channel.title}</h1>
                <p className="small">{res.channel.subs === null ? "" : `${fmtNum(res.channel.subs)} abonnés`}</p>
              </div>
            </div>
          ) : <h1 className="h h-l">« {res.query} »</h1>}
          <span className="mono dim" style={{ marginTop: -8 }}>{list.length} vidéos · classées par score</span>

          <div className="segmented" role="radiogroup" aria-label="Format">
            {FORMATS.map(([id, l]) => <button key={id} role="radio" aria-checked={format === id} className={format === id ? "on" : ""} onClick={() => setFormat(id)}>{l}</button>)}
          </div>

          {!top && <p className="sub">Rien dans ce format.</p>}
          {top && <TopCard v={top} showChannel={showChannel} />}
          {rest.length > 0 && (
            <div className="grid-v">
              {rest.map((v, i) => <Row key={v.id} v={v} n={i + 2} showChannel={showChannel} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** La vidéo n°1 : l'image en grand, le score et la raison en stickers. */
function TopCard({ v, showChannel }: { v: ScoredVideo; showChannel: boolean }) {
  return (
    <Link href={`/video/${v.id}`} className="top-hero">
      {v.thumb && <img referrerPolicy="no-referrer" src={`https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`} onError={(e) => { if (v.thumb) e.currentTarget.src = v.thumb; }} alt="" />}
      <div className="stks">
        <span className="stk lime"><Flame size={13} strokeWidth={2.6} /> N°1</span>
        <span className="big-stk">{fmtScore(v.s.score)}<small>/10</small></span>
      </div>
      <div className="in">
        <span className="why-stk"><Flame size={15} /> {punch(v.s)}</span>
        <span className="t1">{v.title}</span>
        <span className="meta">{showChannel ? `${v.channelTitle} · ` : ""}{fmtNum(v.views)} vues · {fmtAge(v.s.ageJours)} · {v.s.isShort ? "Short" : fmtDur(v.duration)}</span>
      </div>
    </Link>
  );
}

function Row({ v, n, showChannel }: { v: ScoredVideo; n: number; showChannel: boolean }) {
  return (
    <Link href={`/video/${v.id}`} className="gcard">
      <div className="thumb">
        {v.thumb && <img referrerPolicy="no-referrer" src={v.thumb} alt="" loading="lazy" />}
        <span className="rk">#{n}</span>
        <span className="stick"><ScoreBadge score={v.s.score} /></span>
        <span className="dur">{v.s.isShort ? "Short" : fmtDur(v.duration)}</span>
      </div>
      <p className="vtitle">{v.title}</p>
      <p className="small">{showChannel ? `${v.channelTitle} · ` : ""}{fmtNum(v.views)} vues · {fmtAge(v.s.ageJours)}</p>
    </Link>
  );
}

function Loading() {
  return (
    <div className="col" style={{ gap: 10 }} aria-live="polite" aria-label="Chargement">
      <div className="skeleton" style={{ aspectRatio: "16/9" }} />
      {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 72 }} />)}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Resultats /></Suspense>;
}
