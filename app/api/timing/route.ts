import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkAudio, checkImageCount, checkTranscript, computeTiming, saveUpload, toUserMessage } from "@/lib/pipeline";
import { UserFacingError } from "@/lib/stt";

// Transcription may shell out to whisper.cpp: needs the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const error = (message: string, status = 400) => Response.json({ type: "error", message }, { status });

/**
 * Timing only (transcribe + align + cue/scene plan) for the in-browser
 * preview. Images stay in the browser; only their count is needed here.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return error("The upload couldn't be read. Try again, and check the file isn't too large.");
  }

  const audio = form.get("audio");
  const transcript = String(form.get("transcript") ?? "").trim();
  const imageCount = Number(form.get("imageCount") ?? 0);
  const problem = checkAudio(audio) ?? checkTranscript(transcript) ?? checkImageCount(imageCount);
  if (problem) return error(problem);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-video-"));
  try {
    const audioPath = await saveUpload(audio as File, workDir, "narration");
    return Response.json(await computeTiming(audioPath, transcript, imageCount, workDir));
  } catch (err) {
    console.error("[timing]", err);
    return error(toUserMessage(err), err instanceof UserFacingError ? 400 : 500);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
