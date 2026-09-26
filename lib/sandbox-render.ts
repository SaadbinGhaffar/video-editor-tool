import "server-only";
import path from "node:path";
import { addBundleToSandbox, createSandbox, renderMediaOnVercel } from "@remotion/vercel";
import { head, put } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";
import { VERSION } from "remotion/version";
import { UserFacingError } from "./errors";
import type { MainVideoProps, StylePlan } from "./types";

// Built by `npm run vercel-build` and shipped with the function (see next.config.ts).
export const SANDBOX_BUNDLE_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "remotion-build");

const VCPUS = Number(process.env.SANDBOX_VCPUS) || 4;
/** Where the reusable sandbox snapshot's id is remembered, per Remotion version. */
const SNAPSHOT_POINTER = `system/remotion-sandbox-snapshot-${VERSION}.json`;

export type SetupProgress = (message: string, progress: number) => void;

function blobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new UserFacingError(
      "Vercel Blob isn't connected to this project. Add a Blob store in the Vercel dashboard (Storage → Blob), then redeploy.",
    );
  }
  return token;
}

async function readSnapshotId(): Promise<string | null> {
  try {
    const meta = await head(SNAPSHOT_POINTER);
    const res = await fetch(meta.url, { cache: "no-store" });
    const data = (await res.json()) as { snapshotId?: string };
    return data.snapshotId ?? null;
  } catch {
    return null;
  }
}

/**
 * A sandbox ready to render. Setting one up from scratch (system libraries,
 * Remotion, Chrome) takes a minute or two, so the first render saves a
 * snapshot of a prepared sandbox and later renders boot from it in seconds.
 */
async function getSandbox(onProgress: SetupProgress): Promise<Sandbox> {
  const snapshotId = await readSnapshotId();
  if (snapshotId) {
    try {
      onProgress("Starting render machine…", 0.1);
      return await Sandbox.create({
        source: { type: "snapshot", snapshotId },
        resources: { vcpus: VCPUS },
        timeout: 5 * 60 * 1000,
      });
    } catch (err) {
      console.warn("[sandbox] snapshot unusable, rebuilding:", err instanceof Error ? err.message : err);
    }
  }

  // First run (or snapshot expired): build a sandbox, snapshot it, boot from the snapshot.
  const fresh = await createSandbox({
    resources: { vcpus: VCPUS },
    onProgress: ({ progress, message }) =>
      onProgress(`First-time setup of the render machine (a few minutes, once): ${message}`, progress * 0.8),
  });
  onProgress("Saving render machine for next time…", 0.85);
  const snapshot = await fresh.snapshot(); // stops `fresh`
  await put(SNAPSHOT_POINTER, JSON.stringify({ snapshotId: snapshot.snapshotId, createdAt: Date.now() }), {
    access: "public",
    contentType: "application/json",
    allowOverwrite: true,
    addRandomSuffix: false,
    token: blobToken(),
  });
  onProgress("Starting render machine…", 0.9);
  return Sandbox.create({
    source: { type: "snapshot", snapshotId: snapshot.snapshotId },
    resources: { vcpus: VCPUS },
    timeout: 5 * 60 * 1000,
  });
}

/**
 * Start a detached render in a Vercel Sandbox. The sandbox renders, uploads
 * the MP4 to Vercel Blob itself, and reports progress to a file that
 * /api/render-progress polls, so no function has to stay alive for the render.
 */
export async function startSandboxRender(
  jobId: string,
  inputProps: MainVideoProps,
  plan: StylePlan,
  onProgress: SetupProgress,
): Promise<{ sandboxId: string; cmdId: string }> {
  const token = blobToken();
  const sandbox = await getSandbox(onProgress);
  onProgress("Uploading the video template…", 0.95);
  await addBundleToSandbox({ sandbox, bundleDir: SANDBOX_BUNDLE_DIR });

  const { sandboxId, cmdId } = await renderMediaOnVercel({
    sandbox,
    compositionId: "MainVideo",
    inputProps,
    codec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    colorSpace: "bt709",
    crf: Math.min(24, 20 + Math.round(plan.effects.grain * 40)),
    x264Preset: "medium",
    jpegQuality: 90,
    timeoutInMilliseconds: 120_000,
    detached: true,
    detachedSandboxTimeoutInMilliseconds: 30 * 60 * 1000,
    vercelBlob: { blobToken: token, access: "public", blobPath: `renders/${jobId}.mp4` },
  });
  return { sandboxId, cmdId };
}

/** Stop a finished render's sandbox right away instead of letting it idle until its timeout. */
export async function stopSandbox(sandboxId: string) {
  try {
    const sandbox = await Sandbox.get({ sandboxId });
    await sandbox.stop();
  } catch {
    // Already stopped or expired.
  }
}
