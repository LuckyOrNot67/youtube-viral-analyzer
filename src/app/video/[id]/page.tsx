"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Download, Loader2, MessageCircle, Play, Scissors, Sparkles } from "lucide-react";
import { Conf, fmtAge, fmtDur, fmtNum, fmtScore, ScoreBadge } from "@/components/bits";
import type { Channel, CommentsAnalysis, Extrait, ScoredVideo } from "@/lib/types";

type Detail = { video: ScoredVideo; channel: Channel; voisines: ScoredVideo[] };
type Moment = CommentsAnalysis["moments"][number];
type ExtraitsRes = { extraits: Extrait[]; moments: Moment[]; source: "gemini" | "commentaires"; avertissement: string | null };

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
          <span><b style={{ color: "var(--text)" }}>{channel.title}</b> · {channel.subs === null ? "abonnés masqués" : `${fmtNum(channel.subs)} abonnés`} · voir toute la chaîne</span>
        </Link>
      </div>

      <div className="card ink" style={{ gap: 12 }}>
        <div className="row between wrap-row">
          <div className="col" style={{ gap: 2 }}>
            <span className="small" style={{ color: "inherit", opacity: 0.7 }}>Score d&apos;explosion</span>
            <b style={{ fontSize: 18 }}>{s.label}</b>
          </div>
          <ScoreBadge score={s.score} big />
        </div>
        <ul className="list">{s.raisons.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="small" style={{ color: "inherit", opacity: 0.75 }}>
          <Conf c={s.confiance} />{s.confianceRaison ? ` : ${s.confianceRaison}.` : "."} Ce score compare la vidéo à sa chaîne : ce n&apos;est pas une probabilité de devenir virale.
        </p>
      </div>

      <div className="grid-stats">
        <Stat k="vues" v={fmtNum(v.views)} />
        <Stat k={s.vitesseMesuree ? "vues/jour (mesuré)" : "vues/jour en moyenne"} v={fmtNum(s.vuesParJour)} />
        <Stat k="likes" v={fmtNum(v.likes)} />
        <Stat k="commentaires" v={fmtNum(v.comments)} />
        <Stat k="durée" v={fmtDur(v.duration)} />
        <Stat k="publiée" v={fmtAge(s.ageJours)} />
      </div>

      <div className="card">
        <b>Le détail du score</b>
        <Crit label="Surperformance" p={s.parts.surperformance} poids="50 %" />
        <Crit label="Vitesse" p={s.parts.vitesse} poids="25 %" />
        <Crit label="Engagement" p={s.parts.engagement} poids="15 %" />
        <Crit label="Récence" p={s.parts.recence} poids="10 %" />
        <p className="small">
          {s.base.median !== null
            ? `Comparée à ${s.base.n} vidéos ${s.isShort ? "Shorts" : "longues"} de la chaîne d'âge proche : ${fmtNum(s.base.median)} vues en médiane, soit ${s.base.ratio !== null ? fmtScore(s.base.ratio) + "×" : "—"} pour celle-ci.`
            : "Pas assez de vidéos comparables sur la chaîne pour mesurer la surperformance."}
          {" "}Chiffres relevés {fmtAge((Date.now() - v.fetchedAt) / 86400_000)}.
        </p>
      </div>

      {!s.isShort && <Extraits video={v} onSeek={seek} />}
      <Comments videoId={v.id} onSeek={seek} />

      {d.voisines.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <b>Les autres vidéos de la chaîne qui marchent</b>
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

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="stat"><span className="v">{v}</span><span className="k">{k}</span></div>;
}

function Crit({ label, p, poids }: { label: string; p: number; poids: string }) {
  return (
    <div className="crit">
      <span>{label} <span className="small">({poids})</span></span>
      <div className="bar"><span style={{ width: `${Math.round(p * 100)}%` }} /></div>
      <span className="p">{Math.round(p * 100)}</span>
    </div>
  );
}

function Extraits({ video, onSeek }: { video: ScoredVideo; onSeek: (s: number, e?: number) => void }) {
  const [state, setState] = useState<"idle" | "load" | "done">("idle");
  const [res, setRes] = useState<ExtraitsRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [t0, setT0] = useState(0);

  const run = () => {
    setState("load"); setErr(null); setT0(Date.now());
    api<ExtraitsRes>(`/api/video/${video.id}/extraits`, { method: "POST" })
      .then((r) => { setRes(r); setState("done"); })
      .catch((e) => { setErr(e.message); setState("idle"); });
  };

  return (
    <section className="col" style={{ gap: 10 }}>
      <div className="row between"><h2 className="h h-s">Meilleurs extraits pour des Shorts</h2></div>
      {state === "idle" && (
        <>
          <button className="btn accent" onClick={run}><Sparkles size={18} /> Trouver les meilleurs extraits</button>
          <p className="small">L&apos;IA regarde la vidéo ({fmtDur(video.duration)}) et lit les commentaires. Compte 1 à 3 minutes.</p>
        </>
      )}
      {state === "load" && <Waiting since={t0} label="L'IA regarde la vidéo et repère les passages…" />}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res?.avertissement && <div className="notice">{res.avertissement}</div>}
      {res?.extraits.map((x, i) => (
        <div key={`${x.start}-${x.end}`} className={`extrait${sel === i ? " on" : ""}`}>
          <div className="row between wrap-row">
            <span className="time">{fmtDur(x.start)} → {fmtDur(x.end)} · {x.end - x.start} s</span>
            <span className="row" style={{ gap: 6 }}>
              {x.citations > 0 && <span className="chip sm good">Cité {x.citations}× en commentaires</span>}
              <span className="score s-up" title="Potentiel Shorts">{fmtScore(x.scoreShorts)}<small>/10</small></span>
            </span>
          </div>
          <p className="hook">« {x.hook} »</p>
          <p className="small" style={{ color: "var(--text)" }}><b>{x.titre}</b> · {x.type}</p>
          <p className="small">{x.resume}{x.justification ? ` ${x.justification}` : ""}</p>
          <div className="row wrap-row">
            <button className="btn ghost sm" onClick={() => onSeek(x.start, x.end)}><Play size={15} /> Voir le passage</button>
            <button className="btn sm" onClick={() => setSel(sel === i ? null : i)}><Scissors size={15} /> Créer le Short</button>
          </div>
          {sel === i && <ExportShort videoId={video.id} start={x.start} end={x.end} />}
        </div>
      ))}
      {res && res.source === "commentaires" && res.moments.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          {res.moments.map((m) => (
            <div key={m.t} className="extrait">
              <div className="row between"><span className="time">{fmtDur(m.t)}</span><span className="chip sm good">Cité {m.n}×</span></div>
              <p className="small">« {m.exemples[0]} »</p>
              <div className="row wrap-row">
                <button className="btn ghost sm" onClick={() => onSeek(Math.max(0, m.t - 3))}><Play size={15} /> Voir</button>
              </div>
              <ExportShortInline videoId={video.id} start={Math.max(0, m.t - 3)} end={Math.min(video.duration, m.t + 42)} />
            </div>
          ))}
        </div>
      )}
      {res && !res.extraits.length && !res.moments.length && <p className="sub">Aucun passage exploitable trouvé.</p>}
    </section>
  );
}

function ExportShortInline(p: { videoId: string; start: number; end: number }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}><Scissors size={15} /> Créer un Short de 45 s ici</button>;
  return <ExportShort {...p} />;
}

type Job = { etat: "attente" | "telechargement" | "montage" | "pret" | "erreur"; progression: number; erreur: string | null };

function ExportShort({ videoId, start, end }: { videoId: string; start: number; end: number }) {
  const [cadrage, setCadrage] = useState<"entier" | "centre">("entier");
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  const [job, setJob] = useState<{ id: string; j: Job } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.j.etat === "pret" || job.j.etat === "erreur") return;
    const t = setTimeout(() => {
      api<Job>(`/api/short/${job.id}`).then((j) => setJob({ id: job.id, j })).catch((x) => setErr(x.message));
    }, 1200);
    return () => clearTimeout(t);
  }, [job]);

  const go = () => {
    setErr(null);
    api<{ id: string }>("/api/short", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, start: s, end: e, cadrage }) })
      .then(({ id }) => setJob({ id, j: { etat: "attente", progression: 0, erreur: null } }))
      .catch((x) => setErr(x.message));
  };

  const busy = job && job.j.etat !== "pret" && job.j.etat !== "erreur";
  const label = job?.j.etat === "telechargement" ? "Récupération du passage…" : job?.j.etat === "montage" ? "Mise au format vertical…" : "Préparation…";

  return (
    <div className="col" style={{ gap: 10, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
      {job?.j.etat === "pret" ? (
        <div className="export">
          <video src={`/api/short/${job.id}?fichier=1`} controls playsInline />
          <div className="col">
            <b>Ton Short est prêt</b>
            <p className="small">MP4 vertical 1080×1920, son égalisé, {e - s} s. Ajoute tes textes et ta musique dans TikTok, Reels ou Shorts.</p>
            <a className="btn" href={`/api/short/${job.id}?fichier=1&telecharger=1`} download><Download size={18} /> Télécharger le MP4</a>
            <button className="btn ghost sm" onClick={() => setJob(null)}>Refaire avec un autre réglage</button>
          </div>
        </div>
      ) : (
        <>
          <p className="small">Cadrage : {cadrage === "entier" ? "toute l'image, sur un fond flou" : "recadré au centre, remplit l'écran"}.</p>
          <div className="segmented" role="radiogroup" aria-label="Cadrage">
            <button className={cadrage === "entier" ? "on" : ""} onClick={() => setCadrage("entier")} disabled={!!busy}>Image entière</button>
            <button className={cadrage === "centre" ? "on" : ""} onClick={() => setCadrage("centre")} disabled={!!busy}>Plein écran</button>
          </div>
          <div className="col small" style={{ gap: 6 }}>
            <div className="row between">Début <Nudge v={s} set={setS} min={0} max={e - 10} disabled={!!busy} /></div>
            <div className="row between">Fin <Nudge v={e} set={setE} min={s + 10} max={s + 90} disabled={!!busy} /></div>
            <div className="row between">Durée <b style={{ color: "var(--text)" }}>{e - s} s</b></div>
          </div>
          {busy ? (
            <div className="col" style={{ gap: 6 }}>
              <div className="row small"><Loader2 size={15} className="spin" /> {label}</div>
              <div className="bar"><span style={{ width: `${Math.round((job?.j.progression ?? 0) * 100)}%`, transition: "width .4s" }} /></div>
            </div>
          ) : (
            <button className="btn" onClick={go}>Générer le Short <span className="arrow"><ArrowUpRight size={16} strokeWidth={2.5} /></span></button>
          )}
          {(err || job?.j.erreur) && <div className="notice bad" role="alert">{err ?? job?.j.erreur}</div>}
        </>
      )}
    </div>
  );
}

function Nudge({ v, set, min, max, disabled }: { v: number; set: (n: number) => void; min: number; max: number; disabled?: boolean }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <button className="chip sm" disabled={disabled || v - 1 < min} onClick={() => set(v - 1)} aria-label="Une seconde plus tôt">−1 s</button>
      <span className="time">{fmtDur(v)}</span>
      <button className="chip sm" disabled={disabled || v + 1 > max} onClick={() => set(v + 1)} aria-label="Une seconde plus tard">+1 s</button>
    </span>
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
      <h2 className="h h-s">Ce que disent les spectateurs</h2>
      {!res && !load && <button className="btn ghost" onClick={run}><MessageCircle size={18} /> Analyser les commentaires</button>}
      {load && <Waiting since={t0} label="Lecture des commentaires…" />}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res && (
        <div className="col" style={{ gap: 10 }}>
          <p className="small">{res.lus} commentaires les plus pertinents lus{res.total !== null ? ` sur ${fmtNum(res.total)}` : ""}.</p>
          {res.moments.length > 0 && (
            <div className="card green">
              <b>Moments cités par les spectateurs</b>
              {res.moments.slice(0, 5).map((m) => (
                <button key={m.t} className="row" style={{ background: "none", border: 0, padding: 0, textAlign: "left", alignItems: "flex-start" }} onClick={() => onSeek(Math.max(0, m.t - 3))}>
                  <span className="time" style={{ color: "var(--good)", minWidth: 52 }}>{fmtDur(m.t)}</span>
                  <span className="small" style={{ color: "var(--text)" }}>Cité {m.n}× · « {m.exemples[0]} »</span>
                </button>
              ))}
            </div>
          )}
          {res.sujets.length > 0 && <div className="card"><b>Sujets</b><ul className="list">{res.sujets.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {res.questions.length > 0 && <div className="card blue"><b>Questions qui reviennent</b><ul className="list">{res.questions.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          <div className="card"><b>Réactions</b><p className="small" style={{ color: "var(--text)" }}>{res.reactions}</p></div>
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
