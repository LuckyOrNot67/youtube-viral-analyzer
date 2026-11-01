import Link from "next/link";
import { BarChart3, MessageCircle, Scissors } from "lucide-react";
import { SearchBox } from "@/components/SearchBox";
import { EXEMPLES } from "@/lib/exemples";

export default function Home() {
  return (
    <>
      <section className="hero">
        <span className="pill">Pour tes Shorts, Reels et TikTok</span>
        <h1 className="h h-xl">Trouve les vidéos YouTube qui <span className="acc">explosent</span>.</h1>
        <p className="sub">Puis récupère leurs meilleurs passages, prêts à devenir des Shorts, sans regarder 40 minutes de vidéo.</p>
        <SearchBox autoFocus />
        <div className="scroll-x" aria-label="Exemples">
          {EXEMPLES.map((e) => <Link key={e} className="chip" href={`/resultats?q=${encodeURIComponent(e)}`}>{e}</Link>)}
        </div>
      </section>

      <section className="col" style={{ gap: 10, marginTop: 12 }}>
        <div className="card pink">
          <div className="row"><BarChart3 size={18} /><b>Score d&apos;explosion sur 10</b></div>
          <p className="sub" style={{ color: "inherit" }}>Chaque vidéo est comparée aux vidéos habituelles de sa chaîne, pas seulement au nombre de vues.</p>
        </div>
        <div className="card blue">
          <div className="row"><MessageCircle size={18} /><b>Ce que disent les spectateurs</b></div>
          <p className="sub" style={{ color: "inherit" }}>Les moments qu&apos;ils citent, leurs questions, leurs réactions.</p>
        </div>
        <div className="card yel">
          <div className="row"><Scissors size={18} /><b>Les meilleurs extraits, en Short</b></div>
          <p className="sub" style={{ color: "inherit" }}>L&apos;IA regarde la vidéo, propose les passages avec une accroche, et tu exportes un MP4 vertical.</p>
        </div>
      </section>
    </>
  );
}
