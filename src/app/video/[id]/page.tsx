"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Download, Flame, Loader2, MessageCircle, Scissors, Sparkles } from "lucide-react";
import { Conf, fmtAge, fmtDur, fmtNum, fmtScore, punch, ScoreBadge } from "@/components/bits";
import { Cover } from "@/components/Cover";
import type { Channel, CommentsAnalysis, Extrait, ScoredVideo } from "@/lib/types";
import { decouper } from "@/lib/decoupe";

type Detail = { video: ScoredVideo; channel: Channel; voisines: ScoredVideo[] };
type Moment = CommentsAnalysis["moments"][number];
type ExtraitsRes = { extraits: Extrait[]; moments: Moment[]; source: "gemini" | "commentaires"; avertissement: string | null; formule: { nom: string; shortsParVideo: number }; expireLe: number };
type Etape = "commentaires" | "video" | "notes";
const ETAPES: { id: Etape; label: string }[] = [
  { id: "commentaires", label: "Lecture des commentaires" },
  { id: "video", label: "L'IA regarde la vidéo" },
  { id: "notes", label: "Notation des passages" },
];
// Chaque couverture montre une autre partie de l'image, pour que les tuiles ne se ressemblent pas toutes.
const DECALAGES = [50, 22, 78, 35, 65, 10, 90];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({ error: "Réponse illisible." }));
  if (!r.ok) throw new Error(j.error ?? "Erreur.");
  return j as T;
}

/** Lit une réponse envoyée ligne par ligne (une ligne JSON par étape), jusqu'au résultat. */
async function flux<T>(url: string, onLigne: (m: { etape?: Etape }) => void = () => {}): Promise<T> {
  const r = await fetch(url, { method: "POST" });
  if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? "Le serveur ne répond pas. Réessaie.");
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines.filter(Boolean)) {
      const m = JSON.parse(l) as { etape?: Etape; resultat?: T; error?: string };
      if (m.error) throw new Error(m.error);
      if (m.resultat) return m.resultat;
      onLigne(m);
    }
  }
  throw new Error("La réponse s'est arrêtée en route. Réessaie.");
}

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [play, setPlay] = useState<{ start: number; end?: number; n: number } | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Detail>(`/api/video/${id}`).then(setD).catch((e) => setErr(e.message));
  }, [id]);

  const seek = (start: number, end?: number) => {
    setPlay((p) => ({ start, end, n: (p?.n ?? 0) + 1 }));
    playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (err) return <div className="notice bad" role="alert" style={{ marginTop: 16 }}>{err}</div>;
  if (!d) return <div className="col" style={{ gap: 12, paddingTop: 16 }}><div className="skeleton" style={{ aspectRatio: "16/9" }} /><div className="skeleton" style={{ height: 140 }} /></div>;

  const { video: v, channel } = d;
  const s = v.s;
  const src = `https://www.youtube-nocookie.com/embed/${v.id}?rel=0&playsinline=1${play ? `&autoplay=1&start=${play.start}${play.end ? `&end=${play.end}` : ""}` : ""}`;

  return (
    <>
      <div ref={playerRef} className="player" style={{ marginTop: 12, scrollMarginTop: 70 }}>
        <iframe key={play?.n ?? 0} src={src} title={v.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      </div>

      <div className="col" style={{ gap: 8 }}>
        <h1 className="h h-m">{v.title}</h1>
        <Link href={`/resultats?q=${encodeURIComponent(channel.id)}`} className="row small" style={{ gap: 8 }}>
          {channel.avatar && <img referrerPolicy="no-referrer" src={channel.avatar} alt="" style={{ width: 24, height: 24, borderRadius: "50%" }} />}
          <span><b style={{ color: "var(--text)" }}>{channel.title}</b> · {fmtNum(v.views)} vues · {fmtAge(s.ageJours)}</span>
        </Link>
      </div>

      {/* Le verdict en deux blocs de couleur : le score, et ce qui le rend explosif. */}
      <div className="verdict2">
        <div className="vd-score"><span className="mono">Score</span><span className="vd-n">{fmtScore(s.score)}<small>/10</small></span></div>
        <div className="vd-why"><Flame size={22} /><span>{punch(s)}</span></div>
      </div>
      <details className="more">
        <summary>Comment c&apos;est calculé</summary>
        <div className="card col" style={{ gap: 10, marginTop: 8 }}>
          <ul className="list">{s.raisons.map((r) => <li key={r}>{r}</li>)}</ul>
          <Crit label="Surperformance" p={s.parts.surperformance} />
          <Crit label="Vitesse" p={s.parts.vitesse} />
          <Crit label="Engagement" p={s.parts.engagement} />
          <Crit label="Récence" p={s.parts.recence} />
          <p className="small"><Conf c={s.confiance} />{s.confianceRaison ? ` : ${s.confianceRaison}` : ""}</p>
        </div>
      </details>

      {!s.isShort && <Extraits video={v} onSeek={seek} />}
      {!s.isShort && <Histoires video={v} onSeek={seek} />}
      <Comments videoId={v.id} onSeek={seek} />

      {d.voisines.length > 0 && (
        <div className="col" style={{ gap: 10 }}>
          <h2 className="h h-s">Aussi sur la chaîne</h2>
          <div className="scroll-x" style={{ gap: 10 }}>
            {d.voisines.map((o) => (
              <Link key={o.id} href={`/video/${o.id}`} className="mini">
                <div className="thumb">{o.thumb && <img referrerPolicy="no-referrer" src={o.thumb} alt="" loading="lazy" />}<span className="stick"><ScoreBadge score={o.s.score} /></span></div>
                <span className="vtitle" style={{ fontSize: 13.5 }}>{o.title}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Crit({ label, p }: { label: string; p: number }) {
  return (
    <div className="crit">
      <span>{label}</span>
      <div className="bar"><span style={{ width: `${Math.round(p * 100)}%` }} /></div>
      <span className="p">{Math.round(p * 100)}</span>
    </div>
  );
}

type Passage = { start: number; end: number; hook: string; titre: string; note: number | null };

function Extraits({ video, onSeek }: { video: ScoredVideo; onSeek: (s: number, e?: number) => void }) {
  const [state, setState] = useState<"idle" | "load" | "done">("idle");
  const [res, setRes] = useState<ExtraitsRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<Set<number>>(new Set());
  const [vu, setVu] = useState<number | null>(null);
  const [t0, setT0] = useState(0);
  const [etape, setEtape] = useState<Etape | null>(null);

  const run = async () => {
    setState("load"); setErr(null); setT0(Date.now()); setEtape(null);
    try {
      const r = await flux<ExtraitsRes>(`/api/video/${video.id}/extraits`, (m) => { if (m.etape) { setEtape(m.etape); setT0(Date.now()); } });
      setRes(r); setState("done");
    } catch (e) {
      setErr((e as Error).message); setState("idle");
    }
  };

  // Les passages de l'IA, sinon les moments cités dans les commentaires (45 s autour).
  const passages: Passage[] = res
    ? res.extraits.length
      ? res.extraits.map((x) => ({ start: x.start, end: x.end, hook: x.hook, titre: x.titre, note: x.scoreShorts }))
      : res.moments.map((m) => ({ start: Math.max(0, m.t - 3), end: Math.min(video.duration, m.t + 42), hook: m.exemples[0], titre: m.exemples[0], note: null }))
    : [];

  return (
    <section className="col" style={{ gap: 12 }}>
      {state === "idle" && <button className="btn lime arrowed big" onClick={run}><span className="row" style={{ gap: 10 }}><Sparkles size={20} /> Trouver les Shorts</span><span className="arrow"><Scissors size={17} /></span></button>}
      {state === "load" && (
        <ol className="col small" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }} aria-live="polite">
          {ETAPES.map((e, i) => {
            const cur = ETAPES.findIndex((x) => x.id === etape);
            return i < cur
              ? <li key={e.id} className="row">✓ {e.label}</li>
              : i === cur ? <li key={e.id}><Waiting since={t0} label={`${e.label}…`} /></li>
              : <li key={e.id} className="row" style={{ opacity: 0.5 }}>{e.label}</li>;
          })}
        </ol>
      )}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res && !passages.length && <p className="sub">Aucun passage trouvé.</p>}
      {passages.length > 0 && (
        <>
          <div className="sec-head"><h2 className="h h-m">Tes <span className="it acc">Shorts</span></h2><span className="mono dim">{passages.length} passages</span></div>
          {res?.source === "gemini" && <p className="small">Formule {res.formule.nom} : {res.formule.shortsParVideo} Shorts par vidéo, gardés jusqu&apos;au {new Date(res.expireLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} dans <Link href="/shorts" style={{ textDecoration: "underline" }}>Mes Shorts</Link>.</p>}
          <div className="covers">
            {passages.map((x, i) => (
              <div key={`${x.start}-${x.end}`} className={`cover-col${made.has(i) ? " wide" : ""}`}>
                {made.has(i)
                  ? <ExportShort videoId={video.id} start={x.start} end={x.end} titre={x.titre} />
                  : <>
                      <Cover videoId={video.id} decale={DECALAGES[i % DECALAGES.length]} actif={vu === i} onClick={() => { setVu(i); onSeek(x.start, x.end); }}
                        haut={<><span className="tc">{fmtDur(x.start)}</span>{x.note !== null && <span className="stk lime">{fmtScore(x.note)}<small>/10</small></span>}</>}
                        titre={x.hook} bas={<span className="tc">{fmtDur(x.end - x.start)}</span>} />
                      <button className="btn sm" onClick={() => setMade(new Set(made).add(i))}><Scissors size={15} /> Créer</button>
                    </>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

type Job = { etat: "attente" | "telechargement" | "montage" | "pret" | "erreur"; progression: number; erreur: string | null };
type PartieDe = { partie: number; start: number; end: number };

/** Lance le Short dès l'ouverture : plein écran, sans bandes floues ; l'image entière reste au choix. */
function ExportShort({ videoId, start, end, titre, histoire }: { videoId: string; start: number; end: number; titre: string; histoire?: PartieDe }) {
  const [cadrage, setCadrage] = useState<"entier" | "centre">("centre");
  const [job, setJob] = useState<{ id: string; j: Job } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null); setJob(null);
    api<{ id: string }>("/api/short", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, start, end, cadrage, titre, histoire }) })
      .then(({ id }) => setJob({ id, j: { etat: "attente", progression: 0, erreur: null } }))
      .catch((x) => setErr(x.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `histoire` est recréé à chaque rendu, ses valeurs sont start/end
  }, [videoId, start, end, cadrage, titre]);

  useEffect(() => {
    if (!job || job.j.etat === "pret" || job.j.etat === "erreur") return;
    const t = setTimeout(() => {
      api<Job>(`/api/short/${job.id}`).then((j) => setJob({ id: job.id, j })).catch((x) => setErr(x.message));
    }, 1200);
    return () => clearTimeout(t);
  }, [job]);

  const fail = err ?? job?.j.erreur;
  if (fail) return <div className="notice bad" role="alert">{fail}</div>;
  if (job?.j.etat !== "pret") {
    return (
      <div className="making">
        <Loader2 size={20} className="spin" />
        <span>Création du Short…</span>
        <div className="bar" style={{ width: "70%" }}><span style={{ width: `${Math.max(5, Math.round((job?.j.progression ?? 0) * 100))}%`, transition: "width .4s" }} /></div>
      </div>
    );
  }
  return (
    <div className="export">
      <video src={`/api/short/${job.id}?fichier=1`} controls playsInline />
      <div className="col">
        <a className="btn lime" href={`/api/short/${job.id}?fichier=1&telecharger=1`} download><Download size={18} /> Télécharger</a>
        <button className="btn ghost sm" onClick={() => setCadrage(cadrage === "entier" ? "centre" : "entier")}>
          {cadrage === "entier" ? "Version plein écran" : "Version image entière"}
        </button>
      </div>
    </div>
  );
}

type Histoire = { start: number; end: number; titre: string; resume: string; suspense: number[] };
type HistoiresRes = { histoires: Histoire[]; avertissement: string | null; durees: number[] };

/** Histoires en parties (Partie 1, 2, 3…) : coupées sur un moment de suspense, à la durée choisie. */
function Histoires({ video, onSeek }: { video: ScoredVideo; onSeek: (s: number, e?: number) => void }) {
  const [res, setRes] = useState<HistoiresRes | null>(null);
  const [load, setLoad] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [t0, setT0] = useState(0);
  const run = () => {
    setLoad(true); setErr(null); setT0(Date.now());
    flux<HistoiresRes>(`/api/video/${video.id}/histoires`)
      .then(setRes).catch((e) => setErr(e.message)).finally(() => setLoad(false));
  };
  return (
    <section className="col" style={{ gap: 12 }}>
      {!res && !load && <button className="btn ghost" onClick={run}><BookOpen size={18} /> Découper en histoires</button>}
      {(res || load) && <div className="sec-head"><h2 className="h h-m">Histoires en <span className="it acc">parties</span></h2></div>}
      {load && <Waiting since={t0} label="L'IA cherche les histoires… (1 à 3 min)" />}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res?.avertissement && <p className="sub">{res.avertissement}</p>}
      {res?.histoires.map((h) => <UneHistoire key={`${h.start}-${h.end}`} videoId={video.id} h={h} durees={res.durees} onSeek={onSeek} />)}
    </section>
  );
}

function UneHistoire({ videoId, h, durees, onSeek }: { videoId: string; h: Histoire; durees: number[]; onSeek: (s: number, e?: number) => void }) {
  const [cible, setCible] = useState(durees[0] ?? 60);
  const [made, setMade] = useState<Set<number>>(new Set());
  const [vue, setVue] = useState<number | null>(null);
  const parties = decouper(h.start, h.end, h.suspense, cible);
  return (
    <div className="story">
      <div className="col" style={{ gap: 6 }}>
        <span className="row" style={{ gap: 6, flexWrap: "wrap" }}><span className="stk pink">{parties.length} parties</span><span className="stk">{Math.round((h.end - h.start) / 60)} min</span></span>
        <b className="story-t">{h.titre}</b>
        <p className="small">{h.resume}</p>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Durée de chaque partie">
        {durees.map((d) => (
          <button key={d} role="radio" aria-checked={d === cible} className={d === cible ? "on" : ""} onClick={() => { setCible(d); setMade(new Set()); setVue(null); }}>{d / 60} min</button>
        ))}
      </div>
      <div className="covers row-x">
        {parties.map((p) => (
          <div key={`${cible}-${p.n}`} className={`cover-col${made.has(p.n) ? " wide" : ""}`}>
            {made.has(p.n)
              ? <ExportShort videoId={videoId} start={p.start} end={p.end} titre={h.titre} histoire={{ partie: p.n, start: h.start, end: h.end }} />
              : <>
                  <Cover videoId={videoId} decale={DECALAGES[p.n % DECALAGES.length]} actif={vue === p.n} onClick={() => { setVue(p.n); onSeek(p.start, p.end); }}
                    haut={<span className="tc">Jour {p.n}</span>} titre={<span className="part-big">Partie {p.n}</span>} bas={<span className="tc">{fmtDur(p.end - p.start)}</span>} />
                  <button className="btn sm" onClick={() => setMade(new Set(made).add(p.n))}><Scissors size={15} /> Créer</button>
                </>}
          </div>
        ))}
      </div>
      {made.size < parties.length && <button className="btn lime" onClick={() => setMade(new Set(parties.map((p) => p.n)))}>Créer les {parties.length} parties</button>}
    </div>
  );
}

function Comments({ videoId, onSeek }: { videoId: string; onSeek: (s: number) => void }) {
  const [res, setRes] = useState<CommentsAnalysis | null>(null);
  const [load, setLoad] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [t0, setT0] = useState(0);
  const run = () => {
    setLoad(true); setErr(null); setT0(Date.now());
    api<CommentsAnalysis>(`/api/video/${videoId}/commentaires`, { method: "POST" })
      .then(setRes).catch((e) => setErr(e.message)).finally(() => setLoad(false));
  };
  return (
    <section className="col" style={{ gap: 10 }}>
      {!res && !load && <button className="btn ghost" onClick={run}><MessageCircle size={18} /> Ce que disent les spectateurs</button>}
      {(res || load) && <h2 className="h h-m">Ce que disent les <span className="it acc">spectateurs</span></h2>}
      {load && <Waiting since={t0} label="Lecture…" />}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res && (
        <div className="col" style={{ gap: 10 }}>
          {res.moments.length > 0 && (
            <div className="card green">
              <b>Moments cités</b>
              {res.moments.slice(0, 5).map((m) => (
                <button key={m.t} className="row" style={{ background: "none", border: 0, padding: 0, textAlign: "left", alignItems: "flex-start" }} onClick={() => onSeek(Math.max(0, m.t - 3))}>
                  <span className="time" style={{ minWidth: 52 }}>{fmtDur(m.t)}</span>
                  <span className="small" style={{ color: "var(--text)" }}>« {m.exemples[0]} »</span>
                </button>
              ))}
            </div>
          )}
          {res.questions.length > 0 && <div className="card blue"><b>Leurs questions</b><ul className="list">{res.questions.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {res.idees.length > 0 && <div className="card pink"><b>Idées de Shorts</b><ul className="list">{res.idees.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        </div>
      )}
    </section>
  );
}

function Waiting({ since, label }: { since: number; label: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.round((Date.now() - since) / 1000));
  return <div className="row small" aria-live="polite"><Loader2 size={16} className="spin" /> {label} {sec > 2 ? `${sec} s` : ""}</div>;
}
