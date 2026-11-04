"use client";

import { ArrowUpRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Champ unique : une chaîne, un lien de vidéo, un hashtag ou un sujet. */
export function SearchBox({ initial = "", autoFocus }: { initial?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const go = (value: string) => {
    const v = value.trim();
    if (v) router.push(`/resultats?q=${encodeURIComponent(v)}`);
  };
  return (
    <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); go(q); }}>
      <Search size={20} aria-hidden style={{ color: "var(--muted)", flexShrink: 0 }} />
      <input id="q" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} enterKeyHint="search"
        placeholder="Une chaîne, un lien ou un sujet" aria-label="Chaîne, vidéo, hashtag ou sujet" autoComplete="off" />
      <button className="btn" type="submit" disabled={!q.trim()} aria-label="Analyser">
        <span className="lbl">Analyser</span> <span className="arrow"><ArrowUpRight size={18} strokeWidth={2.4} /></span>
      </button>
    </form>
  );
}
