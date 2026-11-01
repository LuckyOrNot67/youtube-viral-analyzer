import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // FFmpeg (binaire) reste tel quel au lieu d'être empaqueté.
  serverExternalPackages: ["ffmpeg-static"],
  images: { remotePatterns: [{ hostname: "i.ytimg.com" }, { hostname: "yt3.ggpht.com" }] },
};

export default nextConfig;
