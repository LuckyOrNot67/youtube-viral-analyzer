"use client";

import { Play } from "lucide-react";
import type { ReactNode } from "react";

/** Une couverture verticale façon TikTok : l'image de la vidéo en grand, recadrée en 9:16, le texte par-dessus. */
export function Cover({ videoId, decale = 50, haut, titre, bas, onClick, actif }: {
  videoId: string; decale?: number; haut?: ReactNode; titre: ReactNode; bas?: ReactNode; onClick?: () => void; actif?: boolean;
}) {
  return (
    <button type="button" className={`cover${actif ? " on" : ""}`} onClick={onClick}>
      <img referrerPolicy="no-referrer" alt="" loading="lazy" style={{ objectPosition: `${decale}% 50%` }}
        src={`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`}
        // Pas d'image en haute définition pour certaines vidéos : on prend la moyenne, sans bandes noires.
        onError={(e) => { const i = e.currentTarget; if (!i.src.includes("mqdefault")) i.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`; }} />
      <span className="cover-top">{haut}</span>
      <span className="cover-play" aria-hidden><Play size={18} fill="currentColor" /></span>
      <span className="cover-txt">{titre}</span>
      {bas && <span className="cover-bas">{bas}</span>}
    </button>
  );
}
