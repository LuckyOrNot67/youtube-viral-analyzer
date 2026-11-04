import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";
import { EXEMPLES } from "@/lib/exemples";

export default function Home() {
  return (
    <section className="hero">
      <span className="mono dim">• YouTube → Shorts</span>
      <h1 className="h h-xl">Trouve la vidéo qui <span className="it">explose.</span></h1>
      <p className="sub" style={{ maxWidth: "40ch" }}>Une chaîne, un sujet ou un lien. Tu vois ce qui cartonne, et l&apos;IA te sort les passages à couper.</p>
      <SearchBox autoFocus />
      <div className="scroll-x" aria-label="Exemples">
        {EXEMPLES.map((e) => <Link key={e} className="chip" href={`/resultats?q=${encodeURIComponent(e)}`}>{e}</Link>)}
      </div>
      <div className="feats">
        <div className="feat f1"><img src="/3d/flame.webp" alt="" /><b>Score sur 10</b><span>Ce qui explose, même sur une petite chaîne</span></div>
        <div className="feat f2"><img src="/3d/scissors.webp" alt="" /><b>Shorts en un clic</b><span>Les meilleurs passages, en vertical</span></div>
        <div className="feat f3"><img src="/3d/play.webp" alt="" /><b>Histoires en parties</b><span>Partie 1, 2, 3… coupées au suspense</span></div>
      </div>
    </section>
  );
}
