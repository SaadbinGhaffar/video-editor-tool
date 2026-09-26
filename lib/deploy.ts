import "server-only";

/**
 * "vercel": uploads go straight from the browser to Vercel Blob and videos
 * render in Vercel Sandbox (Functions can't run Chromium or take large bodies).
 * "local": multipart uploads and renders on this machine with @remotion/renderer.
 */
export type DeployMode = "vercel" | "local";

export const deployMode: DeployMode = process.env.VERCEL || process.env.RENDER_ON_VERCEL_SANDBOX ? "vercel" : "local";

/** Only fetch media from this project's Vercel Blob storage (no arbitrary URLs → no SSRF). */
export function isBlobUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}
