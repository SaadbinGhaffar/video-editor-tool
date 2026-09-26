import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { UserFacingError } from "./errors";

const execFileAsync = promisify(execFile);

/**
 * The ffmpeg binary that ships with Remotion's compositor package for this
 * platform (e.g. @remotion/compositor-linux-x64-gnu). Called directly rather
 * than through the Remotion CLI so it also works inside a Vercel Function.
 */
function findFfmpeg(): { bin: string; dir: string } | null {
  const base = path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", "@remotion");
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(base).filter((d) => d.startsWith(`compositor-${process.platform}-${process.arch}`));
  } catch {
    return null;
  }
  for (const d of dirs) {
    const dir = path.join(base, d);
    const bin = path.join(dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (fs.existsSync(bin)) return { bin, dir };
  }
  return null;
}

/**
 * Convert any supported upload to 16 kHz mono 16-bit WAV (what whisper.cpp
 * needs, and easy to analyse). Cached per work directory.
 */
export async function toWav16k(audioPath: string, workDir: string): Promise<string> {
  const wavPath = path.join(workDir, "narration-16k.wav");
  if (fs.existsSync(wavPath)) return wavPath;
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg from @remotion/compositor-* not found");
  try {
    await execFileAsync(
      ffmpeg.bin,
      ["-y", "-v", "error", "-i", audioPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath],
      // The compositor ships its shared libraries next to the binary.
      { env: { ...process.env, LD_LIBRARY_PATH: [ffmpeg.dir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } },
    );
  } catch {
    throw new UserFacingError("Couldn't decode the audio file. Make sure it's a valid MP3, WAV or M4A.");
  }
  return wavPath;
}

export type SpeechBounds = { onset: number; offset: number; duration: number };

/**
 * Where speech actually starts and ends, from the signal's loudness (20 ms
 * windows against an adaptive noise floor). Recognizers are unreliable at
 * the very edges — whisper.cpp stamps the first word at 0 s even after a
 * long silence — so this is the ground truth for trimming.
 */
export function detectSpeechBounds(wavPath: string): SpeechBounds | null {
  const buf = fs.readFileSync(wavPath);
  // Find the "data" chunk (ffmpeg may write extra chunks before it).
  let pos = 12;
  let dataStart = -1;
  let dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const len = buf.readUInt32LE(pos + 4);
    if (id === "data") {
      dataStart = pos + 8;
      dataLen = Math.min(len, buf.length - dataStart);
      break;
    }
    pos += 8 + len + (len % 2);
  }
  if (dataStart < 0) return null;

  const rate = 16000;
  const win = rate / 50; // 20 ms
  const samples = Math.floor(dataLen / 2);
  const windows = Math.floor(samples / win);
  if (windows < 5) return null;
  const rms = new Float64Array(windows);
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const s = buf.readInt16LE(dataStart + (w * win + i) * 2) / 32768;
      sum += s * s;
    }
    rms[w] = Math.sqrt(sum / win);
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const noise = sorted[Math.floor(windows * 0.1)];
  const peak = sorted[Math.floor(windows * 0.99)];
  if (peak < 0.005) return null; // effectively silent
  const threshold = noise + (peak - noise) * 0.06;

  // Require 3 consecutive loud windows (60 ms) so clicks don't count as speech.
  const loud = (w: number) => rms[w] > threshold && rms[w + 1] > threshold && rms[w + 2] > threshold;
  let first = -1;
  for (let w = 0; w < windows - 2; w++) if (loud(w)) { first = w; break; }
  let last = -1;
  for (let w = windows - 3; w >= 0; w--) if (loud(w)) { last = w + 2; break; }
  if (first < 0 || last < 0) return null;
  return { onset: (first * win) / rate, offset: ((last + 1) * win) / rate, duration: samples / rate };
}
