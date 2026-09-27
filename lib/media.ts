import type { MediaKind } from "./types";

export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm"];

/** Image or video, from a file name, path or URL (and the browser's MIME type when there is one). */
export function mediaKindOf(name: string, mimeType = ""): MediaKind | null {
  const ext = /\.[a-z0-9]+$/i.exec(name.split(/[?#]/)[0])?.[0].toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.includes(ext) || /^image\/(jpeg|png|webp)$/.test(mimeType)) return "image";
  if (VIDEO_EXTENSIONS.includes(ext) || /^video\/(mp4|quicktime|webm|x-m4v)$/.test(mimeType)) return "video";
  return null;
}
