"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Download, Flame, Loader2, Scissors, Sparkles } from "lucide-react";
import { fmtAge, fmtDur, fmtNum, fmtScore, punch, ScoreBadge } from "@/components/bits";
import { Cover } from "@/components/Cover";
import type { Channel, Extrait, MomentCite, ScoredVideo } from "@/lib/types";
import { decouper } from "@/lib/decoupe";
import LIMITES from "@/config/limites.json";

type Detail = { video: ScoredVideo; channel: Channel; voisines: ScoredVideo[] };
type Moment = MomentCite;
type Format = "vertical" | "horizontal";
/** L'avis de l'IA sur le format (gardé pour tout le monde) et le choix de la personne, pour les Shorts ou pour les histoires. */
type FormatInfo = { conseil: { format: Format; raison: string } | null; choix: Format | null };
type ExtraitsRes = { extraits: Extrait[]; moments: Moment[]; source: "gemini" | "commentaires"; avertissement: string | null; format: FormatInfo; formule: { nom: string; shortsParVideo: number }; expireLe: number };
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

/** Gemini saturé : le serveur réessaie tout seul, l'écran propose d'être prévenu par email. */
class Surcharge extends Error {
  constructor(readonly email: boolean) { super("Gemini est surchargé."); }
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
      const m = JSON.parse(l) as { etape?: Etape; resultat?: T; error?: string; surcharge?: boolean; email?: boolean };
      if (m.surcharge) throw new Surcharge(Boolean(m.email));
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
          {(s.points ?? []).map((p) => <Crit key={p.critere} label={p.critere} detail={p.detail} pts={p.points} />)}
          <div className="crit total"><span>Total</span><span className="dim">{s.totalPoints !== undefined ? `${fmtScore(s.totalPoints)} points, ramenés à une note sur 10` : ""}</span><span className="p">{fmtScore(s.score)}/10</span></div>
        </div>
      </details>

      {!s.isShort && (
        <>
          <Extraits video={v} onSeek={seek} />
          <Histoires video={v} onSeek={seek} />
        </>
      )}

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

/** Une ligne du barème : le critère, ce qui a été mesuré, et les points gagnés ou perdus. */
function Crit({ label, detail, pts }: { label: string; detail: string; pts: number }) {
  return (
    <div className="crit">
      <span>{label}</span>
      <span className="dim">{detail}</span>
      <span className={`p${pts > 0 ? " plus" : pts < 0 ? " moins" : ""}`}>{pts > 0 ? "+" : pts < 0 ? "−" : ""}{fmtScore(Math.abs(pts))}</span>
    </div>
  );
}

/** `couverture` : le texte affiché sur la couverture ; `legende` : la description et les hashtags à poster. */
type Passage = { start: number; end: number; couverture: string; titre: string; legende: string | null; note: number | null };

type Sorte = "shorts" | "histoires";

/** Gemini surchargé : on explique, le serveur réessaie, l'écran vérifie seul toutes les 30 s et affiche le résultat
 *  dès qu'il est prêt. Le champ email n'apparaît que si l'envoi d'emails est branché. */
function SurchargeCarte({ videoId, sorte, email: avecEmail, onRetry }: { videoId: string; sorte: Sorte; email: boolean; onRetry: (discret: boolean) => void }) {
  useEffect(() => { const t = setInterval(() => onRetry(true), 30_000); return () => clearInterval(t); }, [onRetry]);
  const [email, setEmail] = useState("");
  const [etat, setEtat] = useState<"" | "envoi" | "ok" | "pret">("");
  const [err, setErr] = useState<string | null>(null);
  const envoyer = (e: React.FormEvent) => {
    e.preventDefault(); setEtat("envoi"); setErr(null);
    api<{ ok?: boolean; pret?: boolean }>(`/api/video/${videoId}/prevenir`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, sorte }) })
      .then((r) => setEtat(r.pret ? "pret" : "ok")).catch((x) => { setErr(x.message); setEtat(""); });
  };
  return (
    <div className="story" role="status">
      <span className="stk pink">L&apos;IA est très demandée</span>
      <b className="story-t">Gemini est surchargé en ce moment.</b>
      <p className="small">Ça se débloque en général en 2 à 3 minutes. On réessaie tout seul, et au plus tard dans 6 minutes on passe sur une IA plus puissante. Reste sur cette page : le résultat s&apos;affiche dès qu&apos;il est prêt. Rien n&apos;est décompté de ta formule avant.</p>
      {!avecEmail ? null : etat === "ok" ? <div className="notice">C&apos;est noté : on t&apos;écrit à {email} dès que c&apos;est prêt.</div>
        : etat === "pret" ? <div className="notice">C&apos;est déjà prêt : clique sur « Réessayer ».</div>
        : (
          <form className="row" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={envoyer}>
            <input id={`prevenir-${sorte}`} type="email" required placeholder="ton@email.fr" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Ton email" className="input" style={{ flex: "1 1 200px" }} />
            <button className="btn lime" disabled={etat === "envoi"}>Préviens-moi</button>
          </form>
        )}
      {err && <div className="notice bad" role="alert">{err}</div>}
      <span className="row small" style={{ gap: 8 }}><Loader2 size={14} className="spin" /> On vérifie toutes les 30 secondes…</span>
    </div>
  );
}

/** Avant le résultat : si l'IA juge que le recadrage vertical cacherait l'essentiel, la personne choisit une fois
 *  pour toutes, à part pour les Shorts et pour les histoires. Sinon (ou une fois choisi), le résultat s'affiche directement. */
function ChoixFormat({ videoId, sorte, info, children }: { videoId: string; sorte: Sorte; info: FormatInfo | undefined; children: ReactNode }) {
  const [choix, setChoix] = useState<Format | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (info?.conseil?.format !== "horizontal" || choix || info.choix) return <>{children}</>;
  const choisir = (format: Format) => {
    setEnvoi(true); setErr(null);
    api<{ choix: Format }>(`/api/video/${videoId}/format`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sorte, format }) })
      .then((r) => setChoix(r.choix)).catch((e) => setErr(e.message)).finally(() => setEnvoi(false));
  };
  const img = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  return (
    <div className="choix-format">
      <div className="cf-txt">
        <span className="stk pink">{sorte === "shorts" ? "Avant tes Shorts" : "Avant tes histoires"}</span>
        <b className="h h-m">Cette vidéo rend mieux <span className="it acc">en horizontal.</span></b>
        <p className="sub">{info.conseil.raison} En vertical, on couperait l&apos;essentiel. En horizontal, TikTok ajoute simplement des bandes noires en haut et en bas.</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn lime" disabled={envoi} onClick={() => choisir("horizontal")}>Garder l&apos;horizontal</button>
          <button className="btn ghost" disabled={envoi} onClick={() => choisir("vertical")}>Vertical quand même</button>
        </div>
        <p className="small">{sorte === "shorts" ? "Ce choix vaut pour tous les Shorts de cette vidéo (les histoires ont leur propre choix)." : "Ce choix vaut pour toutes les parties des histoires de cette vidéo (les Shorts ont leur propre choix)."} Il ne pourra plus être changé.</p>
        {err && <div className="notice bad" role="alert">{err}</div>}
      </div>
      <div className="cf-apercu" aria-hidden>
        <figure><div className="cf-tel h"><img src={img} alt="" referrerPolicy="no-referrer" /></div><figcaption>Horizontal</figcaption></figure>
        <figure><div className="cf-tel v"><img src={img} alt="" referrerPolicy="no-referrer" /></div><figcaption>Vertical</figcaption></figure>
      </div>
    </div>
  );
}

function Extraits({ video, onSeek }: { video: ScoredVideo; onSeek: (s: number, e?: number) => void }) {
  const [state, setState] = useState<"idle" | "load" | "done">("idle");
  const [res, setRes] = useState<ExtraitsRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<Set<number>>(new Set());
  const [vu, setVu] = useState<number | null>(null);
  const [t0, setT0] = useState(0);
  const [etape, setEtape] = useState<Etape | null>(null);
  const [surcharge, setSurcharge] = useState<Surcharge | null>(null);

  // `discret` : vérification en arrière-plan pendant que Gemini est surchargé, sans repasser par l'écran d'attente.
  const run = useCallback(async (discret = false) => {
    if (!discret) { setState("load"); setErr(null); setT0(Date.now()); setEtape(null); setSurcharge(null); }
    try {
      const r = await flux<ExtraitsRes>(`/api/video/${video.id}/extraits`, (m) => { if (m.etape) { setEtape(m.etape); setT0(Date.now()); } });
      setRes(r); setSurcharge(null); setState("done");
    } catch (e) {
      if (e instanceof Surcharge) setSurcharge(e); else if (!discret) setErr((e as Error).message);
      if (!discret) setState("idle");
    }
  }, [video.id]);

  // Les passages de l'IA, sinon les moments cités dans les commentaires (45 s autour).
  const passages: Passage[] = res
    ? res.extraits.length
      ? res.extraits.map((x) => ({ start: x.start, end: x.end, couverture: x.hook ?? x.titre, titre: x.titre, note: x.scoreShorts,
          legende: x.description ? [x.description, (x.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n") : null }))
      : res.moments.map((m) => ({ start: Math.max(0, m.t - 3), end: Math.min(video.duration, m.t + 42), couverture: m.exemples[0], titre: m.exemples[0], legende: null, note: null }))
    : [];

  return (
    <section className="col" style={{ gap: 12 }}>
      {surcharge && state === "idle" && <SurchargeCarte videoId={video.id} sorte="shorts" email={surcharge.email} onRetry={run} />}
      {state === "idle" && !surcharge && <button className="btn lime arrowed big" onClick={() => run()}><span className="row" style={{ gap: 10 }}><Sparkles size={20} /> Trouver les Shorts</span><span className="arrow"><Scissors size={17} /></span></button>}
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
      <ChoixFormat videoId={video.id} sorte="shorts" info={res?.format}>
      {res && !passages.length && <p className="sub">Aucun passage trouvé.</p>}
      {passages.length > 0 && (
        <>
          <div className="sec-head"><h2 className="h h-m">Tes <span className="it acc">Shorts</span></h2><span className="mono dim">{passages.length} passages</span></div>
          {res?.source === "gemini" && <p className="small">Formule {res.formule.nom} : {res.formule.shortsParVideo} Shorts par vidéo, gardés jusqu&apos;au {new Date(res.expireLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} dans <Link href="/shorts" style={{ textDecoration: "underline" }}>Mes Shorts</Link>.</p>}
          <div className="covers">
            {passages.map((x, i) => (
              <div key={`${x.start}-${x.end}`} className={`cover-col${made.has(i) ? " wide" : ""}`}>
                {made.has(i)
                  ? <ExportShort videoId={video.id} start={x.start} end={x.end} titre={x.titre} legende={x.legende} />
                  : <>
                      <Cover videoId={video.id} decale={DECALAGES[i % DECALAGES.length]} actif={vu === i} onClick={() => { setVu(i); onSeek(x.start, x.end); }}
                        haut={<><span className="tc">{fmtDur(x.start)}</span>{x.note !== null && <span className="stk lime">{fmtScore(x.note)}<small>/10</small></span>}</>}
                        titre={x.couverture} bas={<span className="tc">{fmtDur(x.end - x.start)}</span>} />
                      <button className="btn sm" onClick={() => setMade(new Set(made).add(i))}><Scissors size={15} /> Créer</button>
                    </>}
              </div>
            ))}
          </div>
        </>
      )}
      </ChoixFormat>
    </section>
  );
}

type Job = { etat: "attente" | "telechargement" | "montage" | "pret" | "erreur"; progression: number; erreur: string | null };
type PartieDe = { partie: number; start: number; end: number };

/** Lance le Short dès l'ouverture : plein écran, sans bandes floues ; l'image entière reste au choix. */
function ExportShort({ videoId, start, end, titre, legende, histoire, onFin }: { videoId: string; start: number; end: number; titre: string; legende?: string | null; histoire?: PartieDe; onFin?: () => void }) {
  const [job, setJob] = useState<{ id: string; j: Job } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fini = !!err || job?.j.etat === "pret" || job?.j.etat === "erreur";
  // Prévient la file d'attente des parties : la suivante peut commencer.
  useEffect(() => { if (fini) onFin?.(); }, [fini]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setErr(null); setJob(null);
    api<{ id: string }>("/api/short", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, start, end, titre, histoire }) })
      .then(({ id }) => setJob({ id, j: { etat: "attente", progression: 0, erreur: null } }))
      .catch((x) => setErr(x.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `histoire` est recréé à chaque rendu, ses valeurs sont start/end
  }, [videoId, start, end, titre]);

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
        {legende && <Legende texte={legende} />}
      </div>
    </div>
  );
}

/** Légende suggérée pour une partie d'histoire, sans IA : le format « partie 1, 2, 3… » de TikTok. */
const legendePartie = (titre: string, n: number, total: number) =>
  `${titre} (partie ${n}/${total})\n${n < total ? `La suite dans la partie ${n + 1} 👀` : "Fin de l'histoire. Tu veux la prochaine ?"}\n\n#storytime #partie${n} #histoirevraie #pourtoi`;

/** La légende à poster (description et hashtags), à copier d'un clic. */
function Legende({ texte }: { texte: string }) {
  const [copie, setCopie] = useState(false);
  const copier = () => navigator.clipboard.writeText(texte).then(() => { setCopie(true); setTimeout(() => setCopie(false), 1500); }).catch(() => {});
  return (
    <div className="legende">
      <span className="mono dim">Légende suggérée · à adapter</span>
      <p>{texte}</p>
      <button className="btn ghost sm" onClick={copier}>{copie ? "Copiée" : "Copier la légende"}</button>
    </div>
  );
}

type Histoire = { start: number; end: number; titre: string; resume: string; suspense: number[] };
type HistoiresRes = { histoires: Histoire[]; avertissement: string | null; format: FormatInfo; durees: number[] };

/** Histoires en parties (Partie 1, 2, 3…) : coupées sur un moment de suspense, à la durée choisie. */
function Histoires({ video, onSeek }: { video: ScoredVideo; onSeek: (s: number, e?: number) => void }) {
  const [res, setRes] = useState<HistoiresRes | null>(null);
  const [load, setLoad] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [t0, setT0] = useState(0);
  // Demandée avant de lancer : l'IA trouve les moments de suspense une fois, la durée choisie décide où couper.
  const [duree, setDuree] = useState(LIMITES.histoires.durees[0]);
  const [surcharge, setSurcharge] = useState<Surcharge | null>(null);
  const run = useCallback((discret = false) => {
    if (!discret) { setLoad(true); setErr(null); setT0(Date.now()); setSurcharge(null); }
    flux<HistoiresRes>(`/api/video/${video.id}/histoires`)
      .then((r) => { setRes(r); setSurcharge(null); })
      .catch((e) => (e instanceof Surcharge ? setSurcharge(e) : !discret && setErr(e.message)))
      .finally(() => { if (!discret) setLoad(false); });
  }, [video.id]);
  return (
    <section className="col" style={{ gap: 12 }}>
      {surcharge && !load && !res && <SurchargeCarte videoId={video.id} sorte="histoires" email={surcharge.email} onRetry={run} />}
      {!res && !load && !surcharge && (
        <div className="story">
          <b className="story-t">Découper en histoires</b>
          <p className="small">L&apos;IA trouve les histoires complètes de la vidéo et les coupe en parties qui donnent envie de voir la suite. Combien de temps par partie ?</p>
          <div className="segmented" role="radiogroup" aria-label="Durée de chaque partie">
            {LIMITES.histoires.durees.map((d) => (
              <button key={d} role="radio" aria-checked={d === duree} className={d === duree ? "on" : ""} onClick={() => setDuree(d)}>{d / 60} min</button>
            ))}
          </div>
          <button className="btn lime" onClick={() => run()}><BookOpen size={18} /> Découper en parties de {duree / 60} min</button>
        </div>
      )}
      {(res || load) && <div className="sec-head"><h2 className="h h-m">Histoires en <span className="it acc">parties</span></h2></div>}
      {load && <Waiting since={t0} label="L'IA cherche les histoires… (1 à 3 min)" />}
      {err && <div className="notice bad" role="alert">{err}</div>}
      <ChoixFormat videoId={video.id} sorte="histoires" info={res?.format}>
        {res?.avertissement && <p className="sub">{res.avertissement}</p>}
        {res?.histoires.map((h) => <UneHistoire key={`${h.start}-${h.end}`} videoId={video.id} h={h} durees={res.durees} depart={duree} onSeek={onSeek} />)}
      </ChoixFormat>
    </section>
  );
}

function UneHistoire({ videoId, h, durees, depart, onSeek }: { videoId: string; h: Histoire; durees: number[]; depart: number; onSeek: (s: number, e?: number) => void }) {
  const [cible, setCible] = useState(durees.includes(depart) ? depart : durees[0] ?? 60);
  // Les parties demandées, dans l'ordre : une seule se crée à la fois, les autres attendent leur tour.
  const [file, setFile] = useState<number[]>([]);
  const [finies, setFinies] = useState<Set<number>>(new Set());
  const [vue, setVue] = useState<number | null>(null);
  const parties = decouper(h.start, h.end, h.suspense, cible);
  const enCours = file.find((n) => !finies.has(n));
  const demander = (ns: number[]) => setFile((f) => [...f, ...ns.filter((n) => !f.includes(n))]);
  return (
    <div className="story">
      <div className="col" style={{ gap: 6 }}>
        <span className="row" style={{ gap: 6, flexWrap: "wrap" }}><span className="stk pink">{parties.length} parties</span><span className="stk">{Math.round((h.end - h.start) / 60)} min</span></span>
        <b className="story-t">{h.titre}</b>
        <p className="small">{h.resume}</p>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Durée de chaque partie">
        {durees.map((d) => (
          <button key={d} role="radio" aria-checked={d === cible} className={d === cible ? "on" : ""} onClick={() => { setCible(d); setFile([]); setFinies(new Set()); setVue(null); }}>{d / 60} min</button>
        ))}
      </div>
      <div className="covers row-x">
        {parties.map((p) => (
          <div key={`${cible}-${p.n}`} className={`cover-col${finies.has(p.n) || enCours === p.n ? " wide" : ""}`}>
            {finies.has(p.n) || enCours === p.n
              ? <ExportShort videoId={videoId} start={p.start} end={p.end} titre={h.titre} histoire={{ partie: p.n, start: h.start, end: h.end }}
                  legende={legendePartie(h.titre, p.n, parties.length)}
                  onFin={() => setFinies((f) => new Set(f).add(p.n))} />
              : <>
                  <Cover videoId={videoId} decale={DECALAGES[p.n % DECALAGES.length]} actif={vue === p.n} onClick={() => { setVue(p.n); onSeek(p.start, p.end); }}
                    haut={<span className="tc">{file.includes(p.n) ? "En attente" : `Jour ${p.n}`}</span>} titre={<span className="part-big">Partie {p.n}</span>} bas={<span className="tc">{fmtDur(p.end - p.start)}</span>} />
                  {!file.includes(p.n) && <button className="btn sm" onClick={() => demander([p.n])}><Scissors size={15} /> Créer</button>}
                </>}
          </div>
        ))}
      </div>
      {file.length < parties.length && <button className="btn lime" onClick={() => demander(parties.map((p) => p.n))}>Créer les {parties.length} parties</button>}
      {enCours !== undefined && <p className="small">Une partie à la fois, environ 1 min chacune : télécharge-la dès qu&apos;elle est prête, la suivante démarre toute seule.</p>}
    </div>
  );
}

function Waiting({ since, label }: { since: number; label: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.round((Date.now() - since) / 1000));
  return <div className="row small" aria-live="polite"><Loader2 size={16} className="spin" /> {label} {sec > 2 ? `${sec} s` : ""}</div>;
}
