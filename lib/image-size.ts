import "server-only";
import fs from "node:fs";

/**
 * Displayed width/height of a JPEG, PNG or WebP by reading its header — no
 * image library needed. JPEG EXIF orientation is honoured, since phone
 * photos are usually stored sideways with a "rotate 90°" flag and browsers
 * (and so the renderer) display them rotated.
 */
export function readImageAspect(file: string): number | null {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const b = buf.subarray(0, n);
    const size = pngSize(b) ?? webpSize(b) ?? jpegSize(b);
    return size && size.w > 0 && size.h > 0 ? size.w / size.h : null;
  } catch {
    return null;
  }
}

type Size = { w: number; h: number };

function pngSize(b: Buffer): Size | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function webpSize(b: Buffer): Size | null {
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  return null;
}

function jpegSize(b: Buffer): Size | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let orientation = 1;
  let pos = 2;
  while (pos + 9 < b.length) {
    if (b[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = b[pos + 1];
    const len = b.readUInt16BE(pos + 2);
    if (marker === 0xe1 && b.toString("ascii", pos + 4, pos + 8) === "Exif") {
      orientation = exifOrientation(b.subarray(pos + 10, pos + 2 + len)) ?? 1;
    }
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = b.readUInt16BE(pos + 5);
      const w = b.readUInt16BE(pos + 7);
      return orientation >= 5 && orientation <= 8 ? { w: h, h: w } : { w, h };
    }
    pos += 2 + len;
  }
  return null;
}

/** Orientation tag (0x0112) from a TIFF-structured EXIF block. */
function exifOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const le = tiff.toString("ascii", 0, 2) === "II";
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return null;
}
