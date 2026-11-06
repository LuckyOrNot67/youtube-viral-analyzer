"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, Flame, Loader2, Scissors, Sparkles, X } from "lucide-react";
import { fmtAge, fmtDur, fmtNum, fmtScore, punch, ScoreBadge } from "@/components/bits";
import { ChoixRendu, ChoixSousTitres, Tuile, type SousTitres } from "@/components/atelier";
import type { Channel, Extrait, MomentCite, ScoredVideo } from "@/lib/types";
import { decouper } from "@/lib/decoupe";
import LIMITES from "@/config/limites.json";

// Page d'une vidéo, en une seule colonne qui défile d'un bloc : la vidéo, son titre et son score, puis deux onglets
// (Shorts, Histoires). Regarder un passage l'ouvre dans une fenêtre par-dessus la page : on ne perd pas sa place.
// Créer un Short se passe dans sa tuile : rien ne bouge autour, la vidéo prête se lit à la place de la couverture.

type Detail = { video: ScoredVideo; channel: Channel; voisines: ScoredVideo[] };
type Moment = MomentCite;
type Format = "vertical" | "bandes" | "horizontal" | "auto";
/** Le choix de la personne pour les Shorts ou pour les histoires, et s'il est encore modifiable. */
type FormatInfo = { conseil: { format: Format; raison: string; centreX?: number } | null; choix: Format | null; verrouille?: boolean };
type ExtraitsRes = { extraits: Extrait[]; moments: Moment[]; source: "gemini" | "commentaires"; avertissement: string | null; format: FormatInfo; formule: { nom: string; shortsParVideo: number }; expireLe: number };
type Etape = "commentaires" | "video" | "notes";
const ETAPES: { id: Etape; label: string }[] = [
  { id: "commentaires", label: "Lecture des commentaires" },
  { id: "video", label: "L'IA regarde la vidéo" },
  { id: "notes", label: "Notation des passages" },
];
// Chaque couverture montre une autre partie de l'image, pour que les tuiles ne se ressemblent pas toutes.
const DECALAGES = [50, 22, 78, 35, 65, 10, 90];
type Sorte = "shorts" | "histoires";

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
  const [apercu, setApercu] = useState<{ start: number; end?: number } | null>(null);
  const [onglet, setOnglet] = useState<Sorte>("shorts");

  useEffect(() => {
    api<Detail>(`/api/video/${id}`).then(setD).catch((e) => setErr(e.message));
  }, [id]);

  const seek = (start: number, end?: number) => setApercu({ start, end });

  if (err) return <div className="notice bad" role="alert" style={{ marginTop: 16 }}>{err}</div>;
  if (!d) return <div className="col" style={{ gap: 12, paddingTop: 12 }}><div className="skeleton" style={{ aspectRatio: "16/9" }} /><div className="skeleton" style={{ height: 160 }} /></div>;

  const { video: v, channel } = d;
  const s = v.s;
  const src = `https://www.youtube-nocookie.com/embed/${v.id}?rel=0&playsinline=1`;

  return (
    <div className="vp">
      {apercu && <Apercu videoId={v.id} titre={v.title} {...apercu} onClose={() => setApercu(null)} />}
      <div className="player">
        <iframe src={src} title={v.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      </div>
      <div className="vp-head">
        <div className="col" style={{ gap: 6 }}>
          <h1 className="vp-title">{v.title}</h1>
          <Link href={`/resultats?q=${encodeURIComponent(channel.id)}`} className="row small" style={{ gap: 8 }}>
            {channel.avatar && <img referrerPolicy="no-referrer" src={channel.avatar} alt="" style={{ width: 22, height: 22, borderRadius: "50%" }} />}
            <span><b style={{ color: "var(--text)" }}>{channel.title}</b> · {fmtNum(v.views)} vues · {fmtAge(s.ageJours)}</span>
          </Link>
        </div>
        <div className="vp-score">
          <span className="vp-n">{fmtScore(s.score)}<small>/10</small></span>
          <span className="vp-why"><Flame size={18} /> {punch(s)}</span>
        </div>
        <details className="more">
          <summary>Comment le score est calculé</summary>
          <div className="card col" style={{ gap: 10, marginTop: 8 }}>
            {(s.points ?? []).map((p) => <Crit key={p.critere} label={p.critere} detail={p.detail} pts={p.points} />)}
            <div className="crit total"><span>Total</span><span className="dim">{s.totalPoints !== undefined ? `${fmtScore(s.totalPoints)} points, ramenés à une note sur 10` : ""}</span><span className="p">{fmtScore(s.score)}/10</span></div>
          </div>
        </details>
      </div>

      <section className="vp-main">
        {s.isShort ? (
          <div className="panel"><b className="panel-t">C&apos;est déjà un Short</b><p className="small">Cette vidéo est déjà au format vertical : il n&apos;y a rien à découper.</p></div>
        ) : (
          <>
            <div className="tabs" role="tablist" aria-label="Que faire de cette vidéo">
              <button role="tab" aria-selected={onglet === "shorts"} className={onglet === "shorts" ? "on" : ""} onClick={() => setOnglet("shorts")}><Scissors size={16} /> Shorts</button>
              <button role="tab" aria-selected={onglet === "histoires"} className={onglet === "histoires" ? "on" : ""} onClick={() => setOnglet("histoires")}><BookOpen size={16} /> Histoires</button>
            </div>
            {/* Les deux onglets restent montés : changer d'onglet ne perd ni les résultats ni les créations en cours. */}
            <div hidden={onglet !== "shorts"}><Extraits video={v} onSeek={seek} /></div>
            <div hidden={onglet !== "histoires"}><Histoires video={v} onSeek={seek} /></div>
          </>
        )}
      </section>

      {d.voisines.length > 0 && (
        <section className="vp-more col" style={{ gap: 10 }}>
          <h2 className="h h-s">Aussi sur la chaîne</h2>
          <div className="scroll-x" style={{ gap: 10 }}>
            {d.voisines.map((o) => (
              <Link key={o.id} href={`/video/${o.id}`} className="mini">
                <div className="thumb">{o.thumb && <img referrerPolicy="no-referrer" src={o.thumb} alt="" loading="lazy" />}<span className="stick"><ScoreBadge score={o.s.score} /></span></div>
                <span className="vtitle" style={{ fontSize: 13.5 }}>{o.title}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Un passage, lu dans une fenêtre par-dessus la page : on le regarde sans perdre sa place. Échap ou un clic à côté
 *  la ferme. */
function Apercu({ videoId, titre, start, end, onClose }: { videoId: string; titre: string; start: number; end?: number; onClose: () => void }) {
  useEffect(() => {
    const touche = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", touche);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", touche); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="apercu" role="dialog" aria-modal="true" aria-label={`Passage à ${fmtDur(start)}`} onClick={onClose}>
      <div className="apercu-in" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="small" style={{ color: "#fff" }}>Passage {fmtDur(start)}{end ? ` → ${fmtDur(end)}` : ""}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer" autoFocus><X size={18} /></button>
        </div>
        <div className="player">
          <iframe src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1&autoplay=1&start=${start}${end ? `&end=${end}` : ""}`} title={titre} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        </div>
      </div>
    </div>
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
    <div className="panel" role="status">
      <span className="stk pink">L&apos;IA est très demandée</span>
      <b className="panel-t">Gemini est surchargé en ce moment.</b>
      <p className="small">Ça se débloque en général en 2 à 3 minutes. On réessaie tout seul, et au plus tard dans 6 minutes on passe sur une IA plus puissante. Reste sur cette page : le résultat s&apos;affiche dès qu&apos;il est prêt. Rien n&apos;est décompté de ta formule avant.</p>
      {!avecEmail ? null : etat === "ok" ? <div className="notice">C&apos;est noté : on t&apos;écrit à {email} dès que c&apos;est prêt.</div>
        : etat === "pret" ? <div className="notice">C&apos;est déjà prêt : clique sur « Réessayer ».</div>
        : (
          <form className="row" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={envoyer}>
            <input id={`prevenir-${sorte}`} type="email" required placeholder="ton@email.fr" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Ton email" className="input" style={{ flex: "1 1 200px" }} />
            <button className="btn lime sm" disabled={etat === "envoi"}>Préviens-moi</button>
          </form>
        )}
      {err && <div className="notice bad" role="alert">{err}</div>}
      <span className="row small" style={{ gap: 8 }}><Loader2 size={14} className="spin" /> On vérifie toutes les 30 secondes…</span>
    </div>
  );
}

/** Le rendu des Shorts (ou des parties) de cette vidéo : montage auto par défaut, modifiable tant que rien n'est créé. */
function Cadrage({ videoId, sorte, info, cree }: { videoId: string; sorte: Sorte; info?: FormatInfo; cree: boolean }) {
  const [choix, setChoix] = useState<Format | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const actuel = choix ?? (info?.choix && info.choix !== "bandes" ? info.choix : "auto");
  const fige = Boolean(info?.verrouille) || cree;
  const choisir = (format: Format) => {
    if (fige || format === actuel) return;
    const avant = choix;
    setChoix(format); setErr(null);
    api<{ choix: Format }>(`/api/video/${videoId}/format`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sorte, format }) })
      .then((r) => setChoix(r.choix)).catch((e) => { setChoix(avant); setErr(e.message); });
  };
  return (
    <div className="cadrage">
      <ChoixRendu valeur={actuel === "bandes" ? "auto" : actuel} onChange={choisir} fige={fige} image={`https://i.ytimg.com/vi/${videoId}/maxres2.jpg`} />
      <p className="small">{fige ? `Rendu fixé : des ${sorte === "shorts" ? "Shorts sont déjà créés" : "parties sont déjà créées"} avec, pour que tout sorte pareil.` : `Vaut pour ${sorte === "shorts" ? "tous les Shorts" : "toutes les parties"} de cette vidéo. Modifiable tant que rien n'est créé.`}</p>
      {err && <div className="notice bad" role="alert">{err}</div>}
    </div>
  );
}

/** `couverture` : le texte affiché sur la couverture ; `legende` : la description et les hashtags à poster. */
type Passage = { start: number; end: number; couverture: string; titre: string; legende: string | null; note: number | null };

function Extraits({ video, onSeek }: { video: ScoredVideo; onSeek: (s: number, e?: number) => void }) {
  const [state, setState] = useState<"idle" | "load" | "done">("idle");
  const [res, setRes] = useState<ExtraitsRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [demandes, setDemandes] = useState<Set<number>>(new Set());
  const [vu, setVu] = useState<number | null>(null);
  const [t0, setT0] = useState(0);
  const [etape, setEtape] = useState<Etape | null>(null);
  const [surcharge, setSurcharge] = useState<Surcharge | null>(null);
  const [st, setSt] = useState<SousTitres>({ style: "classique", langue: "fr" });
  // Les sous-titres choisis au moment de créer chaque Short (changer de style ensuite ne refait pas les Shorts lancés).
  const [stDe, setStDe] = useState<Record<number, SousTitres>>({});

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
    <div className="col" style={{ gap: 16 }}>
      <Cadrage videoId={video.id} sorte="shorts" info={res?.format} cree={demandes.size > 0} />
      <ChoixSousTitres valeur={st} onChange={setSt} langueVideo={video.lang} />
      {surcharge && state === "idle" && <SurchargeCarte videoId={video.id} sorte="shorts" email={surcharge.email} onRetry={run} />}
      {state === "idle" && !surcharge && (
        <div className="panel">
          <b className="panel-t">Les meilleurs passages, prêts pour TikTok</b>
          <p className="small">L&apos;IA regarde toute la vidéo, garde les passages qui tiennent seuls (une chute, une révélation, un moment drôle) et les note. Tu choisis ceux à créer.</p>
          <button className="btn lime arrowed big" onClick={() => run()}><span className="row" style={{ gap: 10 }}><Sparkles size={20} /> Trouver les Shorts</span><span className="arrow"><Scissors size={17} /></span></button>
        </div>
      )}
      {state === "load" && (
        <ol className="panel col small" style={{ gap: 8, listStyle: "none", margin: 0 }} aria-live="polite">
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
      {res?.avertissement && <p className="small">{res.avertissement}</p>}
      {res && !passages.length && <p className="sub">Aucun passage trouvé.</p>}
      {passages.length > 0 && (
        <>
          <div className="sec-head">
            <h2 className="h h-m">{passages.length} <span className="it acc">passages</span></h2>
            {res?.source === "gemini" && <span className="small">Formule {res.formule.nom} : {res.formule.shortsParVideo} Shorts par vidéo · gardés jusqu&apos;au {new Date(res.expireLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} dans <Link href="/shorts" style={{ textDecoration: "underline" }}>Mes Shorts</Link></span>}
          </div>
          <div className="tuiles">
            {passages.map((x, i) => (
              <Tuile key={`${x.start}-${x.end}`} videoId={video.id} decale={DECALAGES[i % DECALAGES.length]} actif={vu === i}
                onVoir={() => { setVu(i); onSeek(x.start, x.end); }}
                haut={<><span className="tc">{fmtDur(x.start)}</span>{x.note !== null && <span className="stk lime">{fmtScore(x.note)}<small>/10</small></span>}</>}
                titre={x.couverture} bas={<span className="tc">{fmtDur(x.end - x.start)}</span>}
                demande={demandes.has(i) ? { start: x.start, end: x.end, titre: x.titre, legende: x.legende, sousTitres: stDe[i] } : null}
                onCreer={() => { setStDe({ ...stDe, [i]: st }); setDemandes(new Set(demandes).add(i)); }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Légende suggérée pour une partie d'histoire, sans IA : le format « partie 1, 2, 3… » de TikTok. */
const legendePartie = (titre: string, n: number, total: number) =>
  `${titre} (partie ${n}/${total})\n${n < total ? `La suite dans la partie ${n + 1} 👀` : "Fin de l'histoire. Tu veux la prochaine ?"}\n\n#storytime #partie${n} #histoirevraie #pourtoi`;

type PartieH = { n: number; start: number; end: number };
type Histoire = { start: number; end: number; titre: string; resume: string; suspense: number[]; parties?: PartieH[]; decoupes?: Record<string, PartieH[]> };
type HistoiresRes = { histoires: Histoire[]; avertissement: string | null; format: FormatInfo; durees: number[] };

/** Histoires en parties (Partie 1, 2, 3…) : coupées sur un moment de suspense, à la durée choisie. */
function Histoires({ video, onSeek }: { video: ScoredVideo; onSeek: (s: number, e?: number) => void }) {
  const [res, setRes] = useState<HistoiresRes | null>(null);
  const [load, setLoad] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [t0, setT0] = useState(0);
  // Seules les durées qui donnent au moins quelques parties. L'IA prépare les découpes de toutes ces durées d'un coup :
  // changer de durée ensuite est immédiat et gratuit.
  const possibles = LIMITES.histoires.durees.filter((d) => video.duration >= d * LIMITES.histoires.partiesMin);
  const [duree, setDuree] = useState(possibles[0] ?? 60);
  const [surcharge, setSurcharge] = useState<Surcharge | null>(null);
  const [cree, setCree] = useState(false);
  const [st, setSt] = useState<SousTitres>({ style: "classique", langue: "fr" });
  const run = useCallback((discret = false) => {
    if (!discret) { setLoad(true); setErr(null); setT0(Date.now()); setSurcharge(null); }
    flux<HistoiresRes>(`/api/video/${video.id}/histoires`)
      .then((r) => { setRes(r); setSurcharge(null); })
      .catch((e) => (e instanceof Surcharge ? setSurcharge(e) : !discret && setErr(e.message)))
      .finally(() => { if (!discret) setLoad(false); });
  }, [video.id]);
  if (!possibles.length) {
    return <div className="panel"><b className="panel-t">Vidéo trop courte</b><p className="small">Pour une histoire en parties, il faut au moins {Math.round(LIMITES.histoires.durees[0] * LIMITES.histoires.partiesMin / 60)} minutes de vidéo.</p></div>;
  }
  const choixDuree = (
    <div className="segmented" role="radiogroup" aria-label="Durée de chaque partie">
      {possibles.map((d) => (
        <button key={d} role="radio" aria-checked={d === duree} className={d === duree ? "on" : ""} disabled={load} onClick={() => setDuree(d)}>{d / 60} min</button>
      ))}
    </div>
  );
  return (
    <div className="col" style={{ gap: 16 }}>
      <Cadrage videoId={video.id} sorte="histoires" info={res?.format} cree={cree} />
      <ChoixSousTitres valeur={st} onChange={setSt} langueVideo={video.lang} />
      {surcharge && !load && !res && <SurchargeCarte videoId={video.id} sorte="histoires" email={surcharge.email} onRetry={run} />}
      {!res && !load && !surcharge && (
        <div className="panel">
          <b className="panel-t">Toute la vidéo, en parties qui se suivent</b>
          <p className="small">Partie 1, 2, 3… à poster l&apos;une après l&apos;autre. L&apos;IA coupe là où le spectateur veut la suite ; chaque partie reprend 2 à 3 secondes de la précédente. Tu pourras changer de durée ensuite, sans attendre.</p>
          <span className="small"><b style={{ color: "var(--text)" }}>Durée de chaque partie</b></span>
          {choixDuree}
          <button className="btn lime" onClick={() => run()}><BookOpen size={18} /> Découper en parties de {duree / 60} min</button>
        </div>
      )}
      {load && <div className="panel"><Waiting since={t0} label="L'IA regarde la vidéo et note où couper… 1 à 3 min" /></div>}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res?.avertissement && <p className="small">{res.avertissement}</p>}
      {res && <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}><span className="small"><b style={{ color: "var(--text)" }}>Durée de chaque partie</b></span>{choixDuree}</div>}
      {res?.histoires.map((h) => <UneHistoire key={`${duree}-${h.start}-${h.end}`} videoId={video.id} h={h} duree={duree} st={st} onSeek={onSeek} onCree={() => setCree(true)} />)}
    </div>
  );
}

function UneHistoire({ videoId, h, duree, st, onSeek, onCree }: { videoId: string; h: Histoire; duree: number; st: SousTitres; onSeek: (s: number, e?: number) => void; onCree: () => void }) {
  // Les parties demandées, dans l'ordre : une seule se crée à la fois, les autres attendent leur tour.
  const [file, setFile] = useState<number[]>([]);
  const [finies, setFinies] = useState<Set<number>>(new Set());
  const [vue, setVue] = useState<number | null>(null);
  // Les sous-titres choisis au moment où chaque partie est demandée.
  const [stDe, setStDe] = useState<Record<number, SousTitres>>({});
  // Les coupures notées par l'IA pour cette durée ; sinon on recoupe chez nous sur ses moments de suspense.
  const parties = h.decoupes?.[String(duree)] ?? h.parties ?? decouper(h.start, h.end, h.suspense, duree, LIMITES.histoires.partieMax, LIMITES.histoires.recul);
  const enCours = file.find((n) => !finies.has(n));
  const demander = (ns: number[]) => {
    onCree();
    setStDe((d) => ({ ...Object.fromEntries(ns.map((n) => [n, st])), ...d }));
    setFile((f) => [...f, ...ns.filter((n) => !f.includes(n))]);
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="sec-head">
        <div className="col" style={{ gap: 4 }}>
          <h2 className="h h-m">{h.titre}</h2>
          {h.resume && <p className="small">{h.resume}</p>}
        </div>
        <span className="row" style={{ gap: 6 }}><span className="stk pink">{parties.length} parties</span><span className="stk">{Math.round((h.end - h.start) / 60)} min</span></span>
      </div>
      {file.length < parties.length && <button className="btn lime" onClick={() => demander(parties.map((p) => p.n))}><Scissors size={17} /> Créer les {parties.length} parties</button>}
      {enCours !== undefined && <p className="small">Une partie à la fois, environ 1 min chacune : télécharge-la dès qu&apos;elle est prête, la suivante démarre toute seule.</p>}
      <div className="tuiles">
        {parties.map((p) => (
          <Tuile key={p.n} videoId={videoId} decale={DECALAGES[p.n % DECALAGES.length]} actif={vue === p.n}
            onVoir={() => { setVue(p.n); onSeek(p.start, p.end); }}
            haut={<span className="tc">Partie {p.n}</span>} titre={<span className="part-big">Partie {p.n}</span>} bas={<span className="tc">{fmtDur(p.end - p.start)}</span>}
            demande={finies.has(p.n) || enCours === p.n ? { start: p.start, end: p.end, titre: h.titre, histoire: { partie: p.n, start: h.start, end: h.end, duree }, legende: legendePartie(h.titre, p.n, parties.length), sousTitres: stDe[p.n] } : null}
            attente={file.includes(p.n)} onCreer={() => demander([p.n])}
            onFin={() => setFinies((f) => new Set(f).add(p.n))} />
        ))}
      </div>
    </div>
  );
}

function Waiting({ since, label }: { since: number; label: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.round((Date.now() - since) / 1000));
  return <div className="row small" aria-live="polite"><Loader2 size={16} className="spin" /> {label} {sec > 2 ? `${sec} s` : ""}</div>;
}
