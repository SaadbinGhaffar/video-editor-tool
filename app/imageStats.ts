import type { ImageStats } from "@/lib/types";

/**
 * Measure an image's brightness, saturation and colour temperature by
 * drawing it into a tiny canvas. Runs in the browser when an image is added;
 * the numbers feed the per-image colour grade.
 */
export async function measureImage(file: File): Promise<ImageStats | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const aspect = bitmap.width / bitmap.height;
    const w = 48;
    const h = Math.max(1, Math.round(w / aspect));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

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
  } catch {
    return null;
  }
}
