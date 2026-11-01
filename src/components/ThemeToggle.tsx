"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** Bascule entre la DA Fun (claire) et Fun sombre ; le choix est gardé sur cet appareil. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  const toggle = () => {
    const t = dark ? "fun" : "dark";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("yva-theme", t); } catch {}
    setDark(!dark);
  };
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={dark ? "Passer en Fun clair" : "Passer en Fun sombre"}>
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
