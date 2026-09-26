import "server-only";
import fs from "node:fs";
import path from "node:path";
import { alignTranscript, groupIntoCues, planSceneBoundaries, tokenizeTranscript } from "./align";
import { detectSpeechBounds, toWav16k } from "./audio";
import { detectNiche } from "./niche-llm";
import { transcribeWithTimestamps, UserFacingError } from "./stt";
import {
  CAPTION_STYLES,
  MAX_IMAGES,
  MIN_IMAGES,
  MIN_SCENE_SECONDS,
  NICHES,
  type CaptionCue,
  type CaptionStyleId,
  type ImageStats,
  type NicheDetection,
  type NicheId,
  type Timing,
  type TimedWord,
} from "./types";

const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function isFile(v: FormDataEntryValue | null): v is File {
  return typeof v === "object" && v !== null && "arrayBuffer" in v && v.size > 0;
}

/** Returns a user-facing problem with the audio upload, or null if it's fine. */
export function checkAudio(audio: FormDataEntryValue | null): string | null {
  if (!isFile(audio)) return "Please add your narration audio file (MP3, WAV or M4A).";
  if (!AUDIO_EXT.has(path.extname(audio.name).toLowerCase())) {
    return `"${audio.name}" isn't a supported audio file. Use MP3, WAV or M4A.`;
  }
  if (audio.size > MAX_AUDIO_BYTES) return "The audio file is larger than 200 MB.";
  return null;
}

export function checkTranscript(transcript: string): string | null {
  return tokenizeTranscript(transcript).length === 0 ? "Please paste the transcript of your narration." : null;
}

export function checkImageCount(count: number): string | null {
  if (count < MIN_IMAGES) return `Please add at least ${MIN_IMAGES} images (you added ${count}).`;
  if (count > MAX_IMAGES) return `Please add at most ${MAX_IMAGES} images (you added ${count}).`;
  return null;
}

export function checkImages(images: File[]): string | null {
  const countProblem = checkImageCount(images.length);
  if (countProblem) return countProblem;
  for (const img of images) {
    if (!IMAGE_EXT.has(path.extname(img.name).toLowerCase())) {
      return `"${img.name}" isn't a supported image. Use JPG, PNG or WebP (iPhone HEIC photos need converting first).`;
    }
    if (img.size > MAX_IMAGE_BYTES) return `"${img.name}" is larger than 25 MB.`;
  }
  return null;
}

export async function saveUpload(file: File, dir: string, baseName: string): Promise<string> {
  const p = path.join(dir, `${baseName}${path.extname(file.name).toLowerCase()}`);
  fs.writeFileSync(p, Buffer.from(await file.arrayBuffer()));
  return p;
}

/** Leading/trailing silence longer than this is trimmed from the video. */
const KEEP_BEFORE_FIRST_WORD = 0.35;
const KEEP_AFTER_LAST_WORD = 0.9;

/**
 * Transcribe, align the user's wording onto the timing, trim dead air at
 * either end, detect the niche, group cues and plan scene cuts.
 */
export async function computeTiming(
  audioPath: string,
  transcript: string,
  imageCount: number,
  workDir: string,
): Promise<Timing> {
  // Decode once up front: used for speech detection and by local whisper.
  const wavPath = await toWav16k(audioPath, workDir);
  const [{ words: recognized, provider }, detected] = await Promise.all([
    transcribeWithTimestamps(audioPath, transcript, workDir),
    detectNiche(transcript),
  ]);
  const speech = detectSpeechBounds(wavPath);
  const fileDuration =
    (await getAudioDuration(audioPath)) ?? speech?.duration ?? (recognized.at(-1)?.end ?? 0) + 0.5;
  if (!(fileDuration > 0.5) || (!speech && recognized.length === 0)) {
    throw new UserFacingError("The audio seems to be silent or too short. Check the recording and try again.");
  }

  const aligned = alignTranscript(transcript, recognized, fileDuration);

  // Recognizers can stamp the first words before speech actually starts
  // (whisper.cpp puts word one at 0 s after any leading silence): pull those
  // up to the measured onset so the first caption doesn't appear early.
  if (speech) {
    for (const w of aligned) {
      if (w.start >= speech.onset - 0.15) break;
      w.start = speech.onset;
      w.end = Math.max(w.end, w.start + 0.15);
    }
    for (let i = 1; i < aligned.length; i++) {
      if (aligned[i].start < aligned[i - 1].start) aligned[i].start = aligned[i - 1].start;
      if (aligned[i].end < aligned[i].start) aligned[i].end = aligned[i].start;
    }
  }

  // Trim dead air at either end. The measured speech bounds win when we have
  // them (recognizer edge timestamps are unreliable), but never cut into a
  // word that was recognized or aligned, so a partial transcript can't
  // truncate audio that was actually spoken.
  const lastWordStart = Math.max(recognized.at(-1)?.start ?? 0, aligned.at(-1)?.start ?? 0);
  const speechStart = speech
    ? speech.onset
    : Math.min(recognized[0]?.start ?? Infinity, aligned[0]?.start ?? Infinity);
  const speechEnd = speech
    ? Math.max(speech.offset, lastWordStart + 0.3)
    : Math.max(recognized.at(-1)?.end ?? 0, aligned.at(-1)?.end ?? 0);
  let audioOffset = 0;
  let end = fileDuration;
  if (Number.isFinite(speechStart) && speechStart - KEEP_BEFORE_FIRST_WORD > 0.4) {
    audioOffset = speechStart - KEEP_BEFORE_FIRST_WORD;
  }
  if (speechEnd > 0 && fileDuration - (speechEnd + KEEP_AFTER_LAST_WORD) > 0.4) {
    end = speechEnd + KEEP_AFTER_LAST_WORD;
  }
  const durationInSeconds = end - audioOffset;
  const words: TimedWord[] = aligned.map((w) => ({
    text: w.text,
    start: Math.max(0, w.start - audioOffset),
    end: Math.min(durationInSeconds, Math.max(0, w.end - audioOffset)),
  }));

  const maxImages = Math.floor(durationInSeconds / MIN_SCENE_SECONDS);
  if (imageCount > maxImages) {
    throw new UserFacingError(
      `The narration is only ${durationInSeconds.toFixed(1)} s long, which fits at most ${Math.max(MIN_IMAGES, maxImages)} images (each needs about ${MIN_SCENE_SECONDS} s on screen). Remove some images or use a longer recording.`,
    );
  }

  const cues = groupIntoCues(words);
  const bounds = planSceneBoundaries(words, durationInSeconds, imageCount, MIN_SCENE_SECONDS);
  const scenes = Array.from({ length: imageCount }, (_, i) => ({ start: bounds[i], end: bounds[i + 1] }));
  const spoken = words.length > 1 ? words[words.length - 1].end - words[0].start : durationInSeconds;
  const wpm = Math.round((words.length / Math.max(spoken, 1)) * 60);

  return {
    durationInSeconds,
    audioOffset,
    cues,
    scenes,
    words: words.length,
    wpm,
    detected,
    provider,
  };
}

async function getAudioDuration(file: string): Promise<number | null> {
  try {
    const { parseMedia } = await import("@remotion/media-parser");
    const { nodeReader } = await import("@remotion/media-parser/node");
    const { durationInSeconds } = await parseMedia({
      src: file,
      reader: nodeReader,
      fields: { durationInSeconds: true },
      acknowledgeRemotionLicense: true,
    });
    return durationInSeconds ?? null;
  } catch {
    return null;
  }
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Validate timing the browser sends back from a preview, so a render can
 * skip re-transcribing. Returns null if anything is off (the caller then
 * recomputes it from the audio).
 */
export function parseTiming(raw: string | null, imageCount: number): Timing | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Partial<Timing>;
    if (!num(t.durationInSeconds) || t.durationInSeconds <= 0 || t.durationInSeconds > 4 * 3600) return null;
    if (!num(t.audioOffset) || t.audioOffset < 0) return null;
    if (!Array.isArray(t.scenes) || t.scenes.length !== imageCount) return null;
    if (!t.scenes.every((s) => num(s?.start) && num(s?.end) && s.end > s.start)) return null;
    if (!Array.isArray(t.cues)) return null;
    const cues: CaptionCue[] = [];
    for (const c of t.cues) {
      if (!num(c?.start) || !num(c?.end) || !Array.isArray(c.words) || c.words.length === 0) return null;
      if (!c.words.every((w) => typeof w?.text === "string" && num(w.start) && num(w.end))) return null;
      cues.push({ start: c.start, end: c.end, words: c.words.map((w) => ({ text: w.text, start: w.start, end: w.end })) });
    }
    const d = t.detected;
    const detected: NicheDetection = {
      niche: parseNiche(d?.niche) ?? "general",
      confidence: num(d?.confidence) ? d.confidence : 0,
      signals: Array.isArray(d?.signals) ? d.signals.filter((x) => typeof x === "string").slice(0, 5) : [],
      source: d?.source === "llm" ? "llm" : "keywords",
    };
    return {
      durationInSeconds: t.durationInSeconds,
      audioOffset: t.audioOffset,
      scenes: t.scenes.map((s) => ({ start: s.start, end: s.end })),
      cues,
      words: num(t.words) ? t.words : cues.reduce((n, c) => n + c.words.length, 0),
      wpm: num(t.wpm) ? t.wpm : 150,
      detected,
      provider: typeof t.provider === "string" ? t.provider : "preview",
    };
  } catch {
    return null;
  }
}

export function parseNiche(v: unknown): NicheId | null {
  return NICHES.includes(v as NicheId) ? (v as NicheId) : null;
}

export function parseCaptionStyle(v: unknown): CaptionStyleId | null {
  return CAPTION_STYLES.includes(v as CaptionStyleId) ? (v as CaptionStyleId) : null;
}

/** Image colour stats measured in the browser; unknown/invalid entries become null. */
export function parseImageStats(raw: string | null, imageCount: number): (ImageStats | null)[] {
  let list: unknown[] = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    // fall through to all-null
  }
  return Array.from({ length: imageCount }, (_, i) => {
    const s = list[i] as Partial<ImageStats> | null | undefined;
    if (!s || !num(s.luma) || !num(s.saturation) || !num(s.warmth) || !num(s.aspect) || s.aspect <= 0) return null;
    return { luma: s.luma, saturation: s.saturation, warmth: s.warmth, aspect: s.aspect };
  });
}

export function toUserMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOSPC/.test(msg)) return "The server ran out of disk space while rendering.";
  if (/timeout|timed out/i.test(msg)) return "Rendering timed out. Try a shorter clip or smaller images.";
  if (/decode|Invalid data|could not find codec/i.test(msg)) {
    return "One of the files couldn't be decoded. Check the audio and images open normally on your computer.";
  }
  return "Something went wrong while making the video. Check the server log for details and try again.";
}
