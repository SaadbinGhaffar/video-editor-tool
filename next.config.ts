import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The render pipeline uses native binaries (Chromium, ffmpeg, whisper.cpp)
  // and webpack internals; keep these packages out of the server bundle.
  serverExternalPackages: [
    "@remotion/bundler",
    "@remotion/renderer",
    "@remotion/install-whisper-cpp",
    "@remotion/media-parser",
  ],
};

export default nextConfig;
