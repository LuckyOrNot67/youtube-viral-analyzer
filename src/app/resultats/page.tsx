"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { SearchBox } from "@/components/SearchBox";
import { Conf, fmtAge, fmtDur, fmtNum, ScoreBadge } from "@/components/bits";
import type { ScoredVideo, SearchResult } from "@/lib/types";

const TRIS = [
  { id: "score", label: "Score", f: (v: ScoredVideo) => v.s.score },
  { id: "vues", label: "Vues", f: (v: ScoredVideo) => v.views },
  { id: "vpj", label: "Vues/jour", f: (v: ScoredVideo) => v.s.vuesParJour },
  { id: "eng", label: "Engagement", f: (v: ScoredVideo) => v.s.engagement ?? -1 },
  { id: "date", label: "Date", f: (v: ScoredVideo) => -v.s.ageJours },
  { id: "duree", label: "Durée", f: (v: ScoredVideo) => v.duration },
] as const;
const PERIODES = [["24h", "24 h"], ["7j", "7 jours"], ["30j", "30 jours"], ["90j", "90 jours"], ["tout", "Toujours"]] as const;
const DUREES = [["toutes", "Toutes"], ["longues", "Vidéos longues"], ["shorts", "Shorts"]] as const;
const MINS = [[0, "Tous les scores"], [5, "5+"], [6.5, "6,5+"], [8, "8+"]] as const;
const TAILLES = [[0, "Toutes chaînes"], [1, "< 10 k abonnés"], [2, "10 k – 100 k"], [3, "100 k – 1 M"], [4, "> 1 M"]] as const;
const inTaille = (subs: number | null, t: number) =>
  t === 0 || (subs !== null && (t === 1 ? subs < 1e4 : t === 2 ? subs < 1e5 && subs >= 1e4 : t === 3 ? subs < 1e6 && subs >= 1e5 : subs >= 1e6));

function Resultats() {
  const sp = useSearchParams();
  const router = useRouter();
  const q = sp.get("q") ?? "";
  const periode = sp.get("periode") ?? "30j";
  const n = Number(sp.get("n") ?? 200);
  const [res, setRes] = useState<SearchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tri, setTri] = useState<(typeof TRIS)[number]["id"]>("score");
  const [duree, setDuree] = useState<string>(sp.get("duree") ?? "toutes");
  const [min, setMin] = useState(0);
  const [taille, setTaille] = useState(0);

  useEffect(() => {
    if (!q) return;
    let alive = true;
    setRes(null); setErr(null);
    fetch("/api/recherche", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, n, periode, duree: sp.get("duree") ?? undefined }) })
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (j.redirect) router.replace(j.redirect);
        else if (!r.ok) setErr(j.error ?? "Erreur.");
        else setRes(j);
      })
      .catch(() => alive && setErr("Connexion impossible. Vérifie ton réseau."));
    return () => { alive = false; };
  }, [q, n, periode, sp, router]);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set(k, v);
    router.replace(`/resultats?${p}`);
  };

  const list = useMemo(() => {
    if (!res) return [];
    const f = TRIS.find((t) => t.id === tri)!.f;
    return res.videos
      .filter((v) => (duree === "shorts" ? v.s.isShort : duree === "longues" ? !v.s.isShort : true))
      .filter((v) => v.s.score >= min && inTaille(v.subs, taille))
      .sort((a, b) => f(b) - f(a));
  }, [res, tri, duree, min, taille]);

  return (
    <>
      <div style={{ paddingTop: 12 }}><SearchBox key={q} initial={q} /></div>

      {err && <div className="notice bad" role="alert">{err}</div>}
      {!res && !err && <Loading q={q} />}

      {res && (
        <>
          {res.channel ? (
            <div className="chan">
              {res.channel.avatar && <img referrerPolicy="no-referrer" src={res.channel.avatar} alt="" />}
              <div className="col" style={{ gap: 2 }}>
                <h1 className="h h-m">{res.channel.title}</h1>
                <p className="small">{res.channel.subs === null ? "Abonnés masqués" : `${fmtNum(res.channel.subs)} abonnés`} · {res.channel.videoCount.toLocaleString("fr-FR")} vidéos</p>
              </div>
            </div>
          ) : <h1 className="h h-l">Ce qui explose sur « {res.query} »</h1>}
          <p className="small">{res.portee.replace(/\.$/, "")}. Chiffres relevés {fmtAge((Date.now() - res.fetchedAt) / 86400_000)}.</p>

          <div className="col" style={{ gap: 8 }}>
            <div className="scroll-x" aria-label="Trier par">
              {TRIS.map((t) => <button key={t.id} className={`chip sm${tri === t.id ? " on" : ""}`} onClick={() => setTri(t.id)}>{t.label}</button>)}
            </div>
            <div className="scroll-x" aria-label="Filtres">
              {DUREES.map(([id, l]) => <button key={id} className={`chip sm${duree === id ? " on" : ""}`} onClick={() => { setDuree(id); if (res.type === "sujet") setParam("duree", id); }}>{l}</button>)}
              {res.type === "sujet" && PERIODES.map(([id, l]) => <button key={id} className={`chip sm${periode === id ? " on" : ""}`} onClick={() => setParam("periode", id)}>{l}</button>)}
              {res.type === "chaine" && [50, 100, 200, 500].map((k) => <button key={k} className={`chip sm${n === k ? " on" : ""}`} onClick={() => setParam("n", String(k))}>{k} vidéos</button>)}
            </div>
            <div className="scroll-x" aria-label="Score et taille de chaîne">
              {MINS.map(([v, l]) => <button key={v} className={`chip sm${min === v ? " on" : ""}`} onClick={() => setMin(v)}>{l}</button>)}
              {res.type === "sujet" && TAILLES.map(([v, l]) => <button key={v} className={`chip sm${taille === v ? " on" : ""}`} onClick={() => setTaille(v)}>{l}</button>)}
            </div>
          </div>

          {!list.length && <p className="sub">Aucune vidéo avec ces filtres.</p>}
          <div className="col" style={{ gap: 10 }}>
            {list.map((v) => <VideoCard key={v.id} v={v} showChannel={res.type === "sujet"} />)}
          </div>
        </>
      )}
    </>
  );
}

function VideoCard({ v, showChannel }: { v: ScoredVideo; showChannel: boolean }) {
  return (
    <Link href={`/video/${v.id}`} className="vcard">
      <div className="thumb">
        {v.thumb && <img referrerPolicy="no-referrer" src={v.thumb} alt="" loading="lazy" />}
        <span className="rank">#{v.rang}</span>
        <span className="dur">{v.s.isShort ? "Short · " : ""}{fmtDur(v.duration)}</span>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <p className="vtitle">{v.title}</p>
          <ScoreBadge score={v.s.score} />
        </div>
        <div className="stats num">
          {showChannel && <span><b>{v.channelTitle}</b> · {fmtNum(v.subs)} abonnés</span>}
          <span><b>{fmtNum(v.views)}</b> vues</span>
          <span><b>{fmtNum(v.likes)}</b> likes</span>
          <span><b>{fmtNum(v.comments)}</b> comm.</span>
          <span>{fmtAge(v.s.ageJours)}</span>
        </div>
        <p className="why">{v.s.raisons[0]}</p>
        <div className="row"><span className="small">{v.s.label}</span><span className="small">·</span><Conf c={v.s.confiance} /></div>
      </div>
    </Link>
  );
}

function Loading({ q }: { q: string }) {
  return (
    <div className="col" style={{ gap: 10 }} aria-live="polite">
      <p className="sub">Analyse de « {q} » : récupération des vidéos et calcul des scores…</p>
      {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 110 }} />)}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Resultats /></Suspense>;
}
