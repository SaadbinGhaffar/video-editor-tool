import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { denyWithoutAccess } from "@/lib/access";
import { isBlobUrl } from "@/lib/deploy";
import {
  checkAudio,
  checkImageCount,
  checkTranscript,
  computeTiming,
  downloadBlob,
  saveUpload,
  toUserMessage,
} from "@/lib/pipeline";
import { UserFacingError } from "@/lib/stt";

// Transcription may shell out to whisper.cpp / ffmpeg: needs the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const error = (message: string, status = 400) => Response.json({ type: "error", message }, { status });

/**
 * Timing only (transcribe + align + niche + cue/scene plan) for the
 * in-browser preview. Images stay in the browser; only their count is needed.
 * Accepts multipart (local) or JSON with a Vercel Blob audio URL (Vercel).
 */
export async function POST(req: Request) {
  const denied = denyWithoutAccess(req);
  if (denied) return denied;

  let transcript: string;
  let imageCount: number;
  let audio: FormDataEntryValue | null = null;
  let audioUrl: string | null = null;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = (await req.json()) as { audioUrl?: unknown; transcript?: unknown; imageCount?: unknown };
      if (!isBlobUrl(body.audioUrl)) return error("Please add your narration audio file (MP3, WAV or M4A).");
      audioUrl = body.audioUrl;
      transcript = String(body.transcript ?? "").trim();
      imageCount = Number(body.imageCount ?? 0);
    } else {
      const form = await req.formData();
      audio = form.get("audio");
      transcript = String(form.get("transcript") ?? "").trim();
      imageCount = Number(form.get("imageCount") ?? 0);
      const audioProblem = checkAudio(audio);
      if (audioProblem) return error(audioProblem);
    }
  } catch {
    return error("The request couldn't be read. Try again, and check the file isn't too large.");
  }
  const problem = checkTranscript(transcript) ?? checkImageCount(imageCount);
  if (problem) return error(problem);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-video-"));
  try {
    const audioPath = audioUrl
      ? await downloadBlob(audioUrl, workDir, "narration", "audio")
      : await saveUpload(audio as File, workDir, "narration");
    return Response.json(await computeTiming(audioPath, transcript, imageCount, workDir));
  } catch (err) {
    console.error("[timing]", err);
    return error(toUserMessage(err), err instanceof UserFacingError ? 400 : 500);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
