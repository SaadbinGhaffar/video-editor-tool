import type { ImageStats } from "@/lib/types";

/**
 * Measure an image's brightness, saturation and colour temperature by
 * drawing it into a tiny canvas. Runs in the browser when an image is added;
 * the numbers feed the per-image colour grade.
 */
export async function measureImage(file: File): Promise<ImageStats | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const stats = statsOf(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    return stats;
  } catch {
    return null;
  }
}

/**
 * A video clip's length, plus the same colour stats taken from a frame one
 * second in (or halfway, for shorter clips). Either can be null if the
 * browser can't decode the clip; the server then measures the length itself.
 */
export async function measureVideo(file: File): Promise<{ duration: number | null; stats: ImageStats | null }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await once(video, "loadedmetadata");
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    let stats: ImageStats | null = null;
    try {
      video.currentTime = Math.min(1, (duration ?? 2) / 2);
      await once(video, "seeked");
      stats = statsOf(video, video.videoWidth, video.videoHeight);
    } catch {
      // Length is still useful without a frame.
    }
    return { duration, stats };
  } catch {
    return { duration: null, stats: null };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function once(el: HTMLMediaElement, event: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    el.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true });
    el.addEventListener("error", () => (clearTimeout(timer), reject(el.error)), { once: true });
  });
}

function statsOf(source: CanvasImageSource, width: number, height: number): ImageStats | null {
  if (!width || !height) return null;
  const aspect = width / height;
  const w = 48;
  const h = Math.max(1, Math.round(w / aspect));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);

  const { data } = ctx.getImageData(0, 0, w, h);
  let luma = 0;
  let sat = 0;
  let warmth = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sat += max === 0 ? 0 : (max - min) / max;
    warmth += r - b;
  }
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { luma: round(luma / n), saturation: round(sat / n), warmth: round(warmth / n), aspect: round(aspect) };
}
