"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Download, Flame, Loader2, MessageCircle, Play, Scissors, Sparkles } from "lucide-react";
import { Conf, fmtAge, fmtDur, fmtNum, fmtScore, punch, ScoreBadge } from "@/components/bits";
import type { Channel, CommentsAnalysis, Extrait, ScoredVideo } from "@/lib/types";

type Detail = { video: ScoredVideo; channel: Channel; voisines: ScoredVideo[] };
type Moment = CommentsAnalysis["moments"][number];
type ExtraitsRes = { extraits: Extrait[]; moments: Moment[]; source: "gemini" | "commentaires"; avertissement: string | null; formule: { nom: string; shortsParVideo: number }; expireLe: number };
type Etape = "commentaires" | "video" | "notes";
const ETAPES: { id: Etape; label: string }[] = [
  { id: "commentaires", label: "Lecture des commentaires" },
  { id: "video", label: "L'IA regarde la vidéo" },
  { id: "notes", label: "Notation des passages" },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({ error: "Réponse illisible." }));
  if (!r.ok) throw new Error(j.error ?? "Erreur.");
  return j as T;
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

      <div className="col" style={{ gap: 6 }}>
        <h1 className="h h-m">{v.title}</h1>
        <Link href={`/resultats?q=${encodeURIComponent(channel.id)}`} className="row small" style={{ gap: 8 }}>
          {channel.avatar && <img referrerPolicy="no-referrer" src={channel.avatar} alt="" style={{ width: 22, height: 22, borderRadius: "50%" }} />}
          <span><b style={{ color: "var(--text)" }}>{channel.title}</b> · voir la chaîne</span>
        </Link>
      </div>

      <div className="card ink" style={{ gap: 10 }}>
        <div className="row between" style={{ alignItems: "center" }}>
          <div className="col" style={{ gap: 4 }}>
            <p className="punch" style={{ fontSize: 17 }}><Flame size={18} /> {punch(s)}</p>
            <span className="small" style={{ color: "inherit", opacity: 0.75 }}>{fmtNum(v.views)} vues · {fmtAge(s.ageJours)}</span>
          </div>
          <ScoreBadge score={s.score} big />
        </div>
        <details className="more">
          <summary style={{ color: "inherit", opacity: 0.7 }}>Comment c&apos;est calculé</summary>
          <div className="col" style={{ gap: 8 }}>
            <ul className="list">{s.raisons.map((r) => <li key={r}>{r}</li>)}</ul>
            <Crit label="Surperformance" p={s.parts.surperformance} />
            <Crit label="Vitesse" p={s.parts.vitesse} />
            <Crit label="Engagement" p={s.parts.engagement} />
            <Crit label="Récence" p={s.parts.recence} />
            <p className="small" style={{ color: "inherit", opacity: 0.75 }}><Conf c={s.confiance} />{s.confianceRaison ? ` : ${s.confianceRaison}` : ""}</p>
          </div>
        </details>
      </div>

      {!s.isShort && <Extraits video={v} onSeek={seek} />}
      <Comments videoId={v.id} onSeek={seek} />

      {d.voisines.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <h2 className="h h-s">Aussi sur la chaîne</h2>
          {d.voisines.map((o) => (
            <Link key={o.id} href={`/video/${o.id}`} className="row between card" style={{ flexDirection: "row", padding: "10px 14px" }}>
              <span className="vtitle" style={{ fontSize: 14 }}>{o.title}</span>
              <ScoreBadge score={o.s.score} />
            </Link>
          ))}
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
  const [t0, setT0] = useState(0);
  const [etape, setEtape] = useState<Etape | null>(null);

  const run = async () => {
    setState("load"); setErr(null); setT0(Date.now()); setEtape(null);
    try {
      const r = await fetch(`/api/video/${video.id}/extraits`, { method: "POST" });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? "Erreur.");
      // Le serveur envoie une ligne par étape réelle, puis le résultat.
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines.filter(Boolean)) {
          const m = JSON.parse(l) as { etape?: Etape; resultat?: ExtraitsRes; error?: string };
          if (m.etape) { setEtape(m.etape); setT0(Date.now()); }
          if (m.error) throw new Error(m.error);
          if (m.resultat) { setRes(m.resultat); setState("done"); return; }
        }
      }
      throw new Error("La réponse s'est arrêtée en route. Réessaie.");
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
    <section className="col" style={{ gap: 10 }}>
      {state === "idle" && <button className="btn accent" onClick={run}><Sparkles size={18} /> Trouver les Shorts</button>}
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
      {res?.source === "gemini" && passages.length > 0 && (
        <p className="small">Formule {res.formule.nom} : {res.formule.shortsParVideo} Shorts par vidéo. Gardés jusqu&apos;au {new Date(res.expireLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}, dans <Link href="/shorts">Mes Shorts</Link>.</p>
      )}
      {passages.length > 0 && (
        <div className="shorts">
          {passages.map((x, i) => (
            <div key={`${x.start}-${x.end}`} className={`sc${made.has(i) ? " wide" : ""}`}>
              <button className="sc-play" onClick={() => onSeek(x.start, x.end)} aria-label={`Voir le passage à ${fmtDur(x.start)}`}>
                <span className="row between">
                  <span className="sc-time"><Play size={12} fill="currentColor" /> {fmtDur(x.start)}</span>
                  {x.note !== null && <span className="sc-note">{fmtScore(x.note)}</span>}
                </span>
                <span className="sc-hook">{x.hook}</span>
              </button>
              {made.has(i)
                ? <ExportShort videoId={video.id} start={x.start} end={x.end} titre={x.titre} />
                : <button className="btn sm" onClick={() => setMade(new Set(made).add(i))}><Scissors size={15} /> Créer</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type Job = { etat: "attente" | "telechargement" | "montage" | "pret" | "erreur"; progression: number; erreur: string | null };

/** Lance le Short dès l'ouverture : image entière sur fond flou, sans réglage. */
function ExportShort({ videoId, start, end, titre }: { videoId: string; start: number; end: number; titre: string }) {
  const [cadrage, setCadrage] = useState<"entier" | "centre">("entier");
  const [job, setJob] = useState<{ id: string; j: Job } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null); setJob(null);
    api<{ id: string }>("/api/short", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, start, end, cadrage, titre }) })
      .then(({ id }) => setJob({ id, j: { etat: "attente", progression: 0, erreur: null } }))
      .catch((x) => setErr(x.message));
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
    return <div className="bar" aria-label="Création du Short"><span style={{ width: `${Math.max(5, Math.round((job?.j.progression ?? 0) * 100))}%`, transition: "width .4s" }} /></div>;
  }
  return (
    <div className="export">
      <video src={`/api/short/${job.id}?fichier=1`} controls playsInline />
      <div className="col">
        <a className="btn" href={`/api/short/${job.id}?fichier=1&telecharger=1`} download><Download size={18} /> Télécharger</a>
        <button className="btn ghost sm" onClick={() => setCadrage(cadrage === "entier" ? "centre" : "entier")}>
          {cadrage === "entier" ? "Version plein écran" : "Version image entière"}
        </button>
      </div>
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
      {(res || load) && <h2 className="h h-s">Ce que disent les spectateurs</h2>}
      {load && <Waiting since={t0} label="Lecture…" />}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res && (
        <div className="col" style={{ gap: 10 }}>
          {res.moments.length > 0 && (
            <div className="card green">
              <b>Moments cités</b>
              {res.moments.slice(0, 5).map((m) => (
                <button key={m.t} className="row" style={{ background: "none", border: 0, padding: 0, textAlign: "left", alignItems: "flex-start" }} onClick={() => onSeek(Math.max(0, m.t - 3))}>
                  <span className="time" style={{ color: "var(--good)", minWidth: 52 }}>{fmtDur(m.t)}</span>
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
