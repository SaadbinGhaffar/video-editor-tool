"use client";

import type { RenderBudget } from "@/lib/renderBudget";
import type { RenderStatus } from "@/lib/types";

export type AppConfig = {
  mode: "vercel" | "local";
  accessKeyRequired: boolean;
  blobConfigured: boolean;
  transcriptionConfigured: boolean;
  /** Vercel only: the render machine's size and time limit, and the longest video that fits. */
  renderBudget: RenderBudget | null;
  maxVideoSeconds: number | null;
};

/** Give up on a render whose progress hasn't moved for this long. */
const STALL_MS = 10 * 60 * 1000;

const ACCESS_KEY_STORAGE = "auto-video-editor:access-key";

export function loadAccessKey(): string {
  try {
    return localStorage.getItem(ACCESS_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function saveAccessKey(key: string) {
  try {
    localStorage.setItem(ACCESS_KEY_STORAGE, key);
  } catch {
    // Private mode etc.: the key just won't be remembered.
  }
}

export const accessHeaders = (key: string): Record<string, string> => (key ? { "x-access-key": key } : {});

// One upload per selected file, shared by preview and render.
const uploads = new WeakMap<File, Promise<string>>();

/** Upload a file straight from the browser to Vercel Blob (Vercel mode). Returns its URL. */
export function uploadToBlob(
  file: File,
  kind: "audio" | "image" | "video" | "music",
  accessKey: string,
  onProgress?: (loaded: number) => void,
): Promise<string> {
  let pending = uploads.get(file);
  if (!pending) {
    pending = (async () => {
      const { upload } = await import("@vercel/blob/client");
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-80) || kind;
      const blob = await upload(`uploads/${kind}-${safeName}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        clientPayload: accessKey,
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ loaded }) => onProgress?.(loaded),
      });
      return blob.url;
    })();
    // A failed upload shouldn't stick: allow a retry.
    pending.catch(() => uploads.delete(file));
    uploads.set(file, pending);
  }
  return pending;
}

/** Poll a detached Vercel Sandbox render until it finishes. */
export async function pollRender(
  ids: { sandboxId: string; cmdId: string },
  accessKey: string,
  onProgress: (message: string, progress: number) => void,
): Promise<Extract<RenderStatus, { state: "done" }>> {
  const qs = new URLSearchParams(ids).toString();
  let failures = 0;
  let best = -1;
  let movedAt = Date.now();
  while (true) {
    await new Promise((r) => setTimeout(r, 2500));
    let status: RenderStatus;
    try {
      const res = await fetch(`/api/render-progress?${qs}`, { headers: accessHeaders(accessKey), cache: "no-store" });
      status = (await res.json()) as RenderStatus;
      if (!status || !["running", "done", "error"].includes(status.state)) throw new Error("bad status");
      failures = 0;
    } catch {
      // Transient network hiccup: keep polling for a while before giving up.
      if (++failures > 8) throw new Error("Lost contact with the server while rendering. Please try again.");
      continue;
    }
    if (status.state === "done") return status;
    if (status.state === "error") throw new Error(status.message);
    if (status.progress > best) {
      best = status.progress;
      movedAt = Date.now();
    } else if (Date.now() - movedAt > STALL_MS) {
      throw new Error("The render stopped making progress. Please try again with a shorter narration or fewer clips.");
    }
    onProgress(status.message, status.progress);
  }
}
