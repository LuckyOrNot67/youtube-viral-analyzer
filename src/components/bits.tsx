import type { Confiance } from "@/lib/types";

// Petits éléments d'affichage partagés (sans état).

export const fmtNum = (x: number | null | undefined) => {
  if (x === null || x === undefined) return "—";
  const a = Math.abs(x);
  const f = (n: number, u: string) => `${(Math.round(n * 10) / 10).toString().replace(".", ",")} ${u}`;
  if (a >= 1e9) return f(x / 1e9, "Md");
  if (a >= 1e6) return f(x / 1e6, "M");
  if (a >= 1e4) return `${Math.round(x / 1e3)} k`;
  if (a >= 1e3) return f(x / 1e3, "k");
  return String(Math.round(x));
};

export const fmtDur = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

export const fmtAge = (days: number) => {
  if (days < 1) return `il y a ${Math.max(1, Math.round(days * 24))} h`;
  if (days < 30) return `il y a ${Math.round(days)} j`;
  if (days < 365) return `il y a ${Math.round(days / 30)} mois`;
  const y = Math.round(days / 365);
  return `il y a ${y} an${y > 1 ? "s" : ""}`;
};

export const fmtScore = (s: number) => s.toFixed(1).replace(".", ",");

export function ScoreBadge({ score, big }: { score: number; big?: boolean }) {
  const tone = score >= 8 ? "s-hot" : score >= 6.5 ? "s-up" : score >= 5 ? "s-mid" : "s-low";
  return <span className={`score ${tone}${big ? " big" : ""}`}>{fmtScore(score)}<small>/10</small></span>;
}

export function Conf({ c }: { c: Confiance }) {
  return <span className={`conf ${c}`}>Confiance {c}</span>;
}
