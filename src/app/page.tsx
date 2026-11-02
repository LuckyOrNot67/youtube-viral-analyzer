import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";
import { EXEMPLES } from "@/lib/exemples";

export default function Home() {
  return (
    <section className="hero">
      <h1 className="h h-xl">Trouve la vidéo qui <span className="acc">explose</span>.</h1>
      <SearchBox autoFocus />
      <div className="scroll-x" aria-label="Exemples">
        {EXEMPLES.map((e) => <Link key={e} className="chip" href={`/resultats?q=${encodeURIComponent(e)}`}>{e}</Link>)}
      </div>
    </section>
  );
}
