import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Clapperboard, Flame } from "lucide-react";
import "./globals.css";
import { ThemeToggle } from "@/components/ThemeToggle";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-serif" });

export const metadata: Metadata = {
  title: "Viral Analyzer · Les vidéos YouTube qui explosent",
  description: "Trouve les vidéos YouTube qui explosent et découvre les meilleurs extraits pour tes prochains Shorts.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" data-theme="fun" className={`${sans.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* Thème choisi (clair ou sombre), sinon celui du téléphone, appliqué avant l'affichage. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("yva-theme");if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"fun";document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-in">
            <Link href="/" className="logo"><span className="logo-mark"><Flame size={17} strokeWidth={2.6} /></span>Viral Analyzer</Link>
            <div className="row" style={{ gap: 8 }}>
              <Link href="/shorts" className="btn ghost sm" style={{ minHeight: 40 }}><Clapperboard size={16} /> Mes Shorts</Link>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
