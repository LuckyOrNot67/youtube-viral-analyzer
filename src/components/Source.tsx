import Link from "next/link";

/** YouTube ou Twitch : les deux versions de l'app, d'un clic. */
export function Source({ actif }: { actif: "youtube" | "twitch" }) {
  return (
    <nav className="source" aria-label="Plateforme">
      <Link href="/" className={actif === "youtube" ? "on yt" : ""} aria-current={actif === "youtube" ? "page" : undefined}><span className="pastille yt" aria-hidden />YouTube</Link>
      <Link href="/twitch" className={actif === "twitch" ? "on tw" : ""} aria-current={actif === "twitch" ? "page" : undefined}><span className="pastille tw" aria-hidden />Twitch</Link>
    </nav>
  );
}
