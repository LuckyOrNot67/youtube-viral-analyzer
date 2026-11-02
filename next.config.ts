import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Permet une version de production à côté du serveur de dev (ex. NEXT_DIST_DIR=.next-prod pour le lien public).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // FFmpeg (binaire) reste tel quel au lieu d'être empaqueté.
  serverExternalPackages: ["ffmpeg-static"],
  images: { remotePatterns: [{ hostname: "i.ytimg.com" }, { hostname: "yt3.ggpht.com" }] },
};

export default nextConfig;
