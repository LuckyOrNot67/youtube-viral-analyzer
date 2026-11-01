import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Flame } from "lucide-react";
import "./globals.css";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Viral Analyzer · Les vidéos YouTube qui explosent",
  description: "Trouve les vidéos YouTube qui explosent et découvre les meilleurs extraits pour tes prochains Shorts.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" data-theme="fun" suppressHydrationWarning>
      <head>
        {/* Thème choisi (Fun ou Fun sombre), sinon celui du téléphone, appliqué avant l'affichage. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("yva-theme");if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"fun";document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-in">
            <Link href="/" className="logo"><span className="logo-mark"><Flame size={18} strokeWidth={2.6} /></span>Viral Analyzer</Link>
            <ThemeToggle />
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
