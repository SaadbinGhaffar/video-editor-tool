import "server-only";
import fs from "node:fs";
import path from "node:path";
import { buildVideoProps } from "./style";
import type { StylePlan, Timing } from "./types";

const ENTRY_POINT = path.join(process.cwd(), "remotion", "index.ts");
// Dedicated (empty) public dir for the bundle, so the app's own /public —
// which holds finished renders — isn't copied into every bundle.
const REMOTION_PUBLIC_DIR = path.join(process.cwd(), "remotion", "public");
// Fixed output dir: each server start re-bundles over it instead of leaving
// a new bundle in the OS temp folder every time.
const BUNDLE_DIR = path.join(process.cwd(), ".remotion-bundle");
export const RENDERS_DIR = path.join(process.cwd(), "public", "renders");

// Bundling takes a while (webpack), so do it once per server process. Stored on
// globalThis so dev-mode module reloads don't re-bundle on every request.
const g = globalThis as unknown as { __remotionBundle?: Promise<string>; __renderQueue?: Promise<unknown> };

function getBundle(): Promise<string> {
  if (!g.__remotionBundle) {
    g.__remotionBundle = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({ entryPoint: ENTRY_POINT, publicDir: REMOTION_PUBLIC_DIR, outDir: BUNDLE_DIR });
    })();
    g.__remotionBundle.catch(() => {
      g.__remotionBundle = undefined;
    });
  }
  return g.__remotionBundle;
}

/** Run renders one at a time — each one already saturates the CPU. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const prev = g.__renderQueue ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(job);
  g.__renderQueue = next;
  return next;
}

export type RenderAssets = {
  audioPath: string;
  imagePaths: string[];
};

export type RenderProgress = (stage: "bundling" | "queued" | "rendering", progress?: number) => void;

/**
 * Render the composition to public/renders/<jobId>.mp4. Asset files are copied
 * into the bundle's public folder (which Remotion's render server serves) for
 * the duration of the render and removed afterwards.
 */
export async function renderVideo(
  jobId: string,
  assets: RenderAssets,
  timing: Timing,
  plan: StylePlan,
  onProgress: RenderProgress,
): Promise<string> {
  onProgress("bundling");
  const serveUrl = await getBundle();
  const { ensureBrowser, renderMedia, selectComposition } = await import("@remotion/renderer");
  await ensureBrowser();

  onProgress("queued");
  return enqueue(async () => {
    const jobPublic = path.join(serveUrl, "public", "jobs", jobId);
    fs.mkdirSync(jobPublic, { recursive: true });
    try {
      const rel = (file: string) => {
        const name = path.basename(file);
        fs.copyFileSync(file, path.join(jobPublic, name));
        return `jobs/${jobId}/${name}`;
      };
      const inputProps = buildVideoProps(timing, plan, rel(assets.audioPath), assets.imagePaths.map(rel));

      const composition = await selectComposition({ serveUrl, id: "MainVideo", inputProps });
      fs.mkdirSync(RENDERS_DIR, { recursive: true });
      const outputLocation = path.join(RENDERS_DIR, `${jobId}.mp4`);

      onProgress("rendering", 0);
      await renderMedia({
        serveUrl,
        composition,
        inputProps,
        codec: "h264",
        audioCodec: "aac",
        pixelFormat: "yuv420p",
        colorSpace: "bt709",
        // Slow-moving photos compress well; CRF 20 keeps them clean at a
        // fraction of the default size. Film grain is noise the encoder has
        // to spend bits on, so grainy styles get a slightly higher CRF
        // (invisible under the grain) to keep downloads a sensible size.
        crf: Math.min(24, 20 + Math.round(plan.effects.grain * 40)),
        x264Preset: "medium",
        jpegQuality: 90,
        outputLocation,
        timeoutInMilliseconds: 120_000,
        onProgress: ({ progress }) => onProgress("rendering", progress),
      });
      return outputLocation;
    } finally {
      fs.rmSync(jobPublic, { recursive: true, force: true });
    }
  });
}

/** Delete finished renders older than maxAgeHours so the disk doesn't fill up. */
export function pruneOldRenders(maxAgeHours = 24) {
  if (!fs.existsSync(RENDERS_DIR)) return;
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  for (const name of fs.readdirSync(RENDERS_DIR)) {
    if (!name.endsWith(".mp4")) continue;
    const file = path.join(RENDERS_DIR, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    } catch {
      // Another request may have removed it already.
    }
  }
}
