import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The render pipeline uses native binaries (Chromium, ffmpeg, whisper.cpp)
  // and webpack internals; keep these packages out of the server bundle.
  serverExternalPackages: [
    "@remotion/bundler",
    "@remotion/renderer",
    "@remotion/install-whisper-cpp",
    "@remotion/media-parser",
    "@remotion/vercel",
    "@vercel/sandbox",
  ],
  // Files read at runtime by path, which the tracer can't discover:
  // the prebuilt Remotion bundle (uploaded into each Vercel Sandbox) and
  // Remotion's Linux ffmpeg (used for speech detection).
  outputFileTracingIncludes: {
    "/api/generate": ["./remotion-build/**/*", "./node_modules/@remotion/compositor-linux-x64-gnu/**/*"],
    "/api/timing": ["./node_modules/@remotion/compositor-linux-x64-gnu/**/*"],
  },
};

export default nextConfig;
