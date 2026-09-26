import "server-only";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { toWav16k } from "./audio";
import { UserFacingError } from "./errors";
import type { TimedWord } from "./types";

export { UserFacingError };

/** OpenAI's upload limit for the transcription endpoint. */
const OPENAI_MAX_BYTES = 25 * 1024 * 1024;

export const WHISPER_DIR = path.join(process.cwd(), ".whisper");
export const WHISPER_CPP_DIR = path.join(WHISPER_DIR, "whisper.cpp");
export const WHISPER_CPP_VERSION = "1.5.5";
export const WHISPER_MODEL = "base.en" as const;

export type SttResult = { words: TimedWord[]; provider: string };

/**
 * Word-level timestamps for the narration. The transcript is passed as a
 * vocabulary hint only — the caller aligns the user's wording afterwards.
 */
export async function transcribeWithTimestamps(
  audioPath: string,
  transcriptHint: string,
  workDir: string,
): Promise<SttResult> {
  if (process.env.OPENAI_API_KEY) {
    return { words: await transcribeOpenAI(audioPath, transcriptHint), provider: "openai-whisper-1" };
  }
  if (localWhisperInstalled()) {
    return { words: await transcribeLocal(audioPath, workDir), provider: `whisper.cpp ${WHISPER_MODEL}` };
  }
  throw new UserFacingError(
    "No speech-to-text is configured. Add OPENAI_API_KEY to .env.local, or run `npm run setup:whisper` to install local transcription, then restart the server.",
  );
}

async function transcribeOpenAI(audioPath: string, hint: string): Promise<TimedWord[]> {
  const size = fs.statSync(audioPath).size;
  if (size > OPENAI_MAX_BYTES) {
    throw new UserFacingError(
      `The audio file is ${(size / 1024 / 1024).toFixed(1)} MB; the transcription service accepts up to 25 MB. Export it as a lower-bitrate MP3 and try again.`,
    );
  }
  const client = new OpenAI();
  try {
    const res = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      // Whisper only reads the last ~224 tokens of the prompt; the opening of
      // the script is enough to prime names and jargon.
      prompt: hint.slice(0, 800),
    });
    return (res.words ?? []).map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }));
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) throw new UserFacingError("The OpenAI API key was rejected. Check OPENAI_API_KEY in .env.local.");
      if (err.status === 429) throw new UserFacingError("OpenAI rate limit or quota reached. Wait a moment or check your billing, then try again.");
      if (err.status === 400) throw new UserFacingError(`The transcription service couldn't read this audio file (${err.message}). Try exporting it as MP3 or WAV.`);
    }
    throw err;
  }
}

function localWhisperInstalled(): boolean {
  return fs.existsSync(WHISPER_CPP_DIR) && fs.existsSync(path.join(WHISPER_CPP_DIR, `ggml-${WHISPER_MODEL}.bin`));
}

async function transcribeLocal(audioPath: string, workDir: string): Promise<TimedWord[]> {
  const { transcribe } = await import("@remotion/install-whisper-cpp");

  // whisper.cpp only reads 16 kHz mono WAV.
  const wavPath = await toWav16k(audioPath, workDir);

  const out = await transcribe({
    inputPath: wavPath,
    whisperPath: WHISPER_CPP_DIR,
    whisperCppVersion: WHISPER_CPP_VERSION,
    model: WHISPER_MODEL,
    modelFolder: WHISPER_CPP_DIR,
    tokenLevelTimestamps: true,
  });

  // whisper.cpp returns sub-word tokens; a leading space marks a new word.
  const words: TimedWord[] = [];
  for (const item of out.transcription) {
    for (const tok of item.tokens) {
      if (/^\s*\[_[A-Z]+_?\d*\]\s*$/.test(tok.text) || tok.text.trim() === "") continue;
      const start = tok.offsets.from / 1000;
      const end = tok.offsets.to / 1000;
      const last = words[words.length - 1];
      if (last && !/^\s/.test(tok.text)) {
        last.text += tok.text;
        last.end = Math.max(last.end, end);
      } else {
        words.push({ text: tok.text.trim(), start, end });
      }
    }
  }
  return words;
}
