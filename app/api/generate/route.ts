import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkAudio,
  checkImages,
  checkTranscript,
  computeTiming,
  isFile,
  parseCaptionStyle,
  parseImageStats,
  parseNiche,
  parseTiming,
  saveUpload,
  toUserMessage,
} from "@/lib/pipeline";
import { readImageAspect } from "@/lib/image-size";
import { pruneOldRenders, renderVideo } from "@/lib/render";
import { NEUTRAL_IMAGE_STATS, planStyle } from "@/lib/style";
import type { GenerateEvent } from "@/lib/types";

// Rendering launches headless Chromium + ffmpeg: needs a real Node process.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const badRequest = (message: string) => Response.json({ type: "error", message }, { status: 400 });

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("The upload couldn't be read. Try again, and check the files aren't too large.");
  }

  // ---- Validate the three inputs up front, before any slow work. ----
  const audio = form.get("audio");
  const transcript = String(form.get("transcript") ?? "").trim();
  const images = form.getAll("images").filter(isFile);
  const problem = checkAudio(audio) ?? checkTranscript(transcript) ?? checkImages(images);
  if (problem) return badRequest(problem);

  // Timing from an earlier preview, if the browser sent one (skips transcription).
  const previewTiming = parseTiming(form.get("timing") as string | null, images.length);
  // Style choices: "auto" (or anything unrecognised) means use the detected niche / its default captions.
  const nicheOverride = parseNiche(form.get("niche"));
  const captionOverride = parseCaptionStyle(form.get("captionStyle"));
  const imageStats = parseImageStats(form.get("imageStats") as string | null, images.length);

  const jobId = randomUUID();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-video-"));

  // Save uploads before the response starts streaming.
  const audioPath = await saveUpload(audio as File, workDir, "narration");
  const imagePaths: string[] = [];
  for (const [i, img] of images.entries()) imagePaths.push(await saveUpload(img, workDir, `image-${i + 1}`));
  // Without browser-measured stats (e.g. API use), still detect portrait
  // images from their headers so they're shown whole rather than cropped.
  imagePaths.forEach((p, i) => {
    if (imageStats[i]) return;
    const aspect = readImageAspect(p);
    if (aspect) imageStats[i] = { ...NEUTRAL_IMAGE_STATS, aspect };
  });

  // ---- Run the pipeline, streaming progress as newline-delimited JSON. ----
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: GenerateEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      let lastPct = -1;
      try {
        pruneOldRenders();

        let timing = previewTiming;
        if (!timing) {
          send({ type: "progress", stage: "transcribing", message: "Transcribing audio for word timing…" });
          timing = await computeTiming(audioPath, transcript, imagePaths.length, workDir);
        }
        // Same pure planner the browser preview uses, so the render matches it.
        const plan = planStyle({
          niche: nicheOverride ?? timing.detected.niche,
          caption: captionOverride,
          timing,
          imageStats,
        });

        const output = await renderVideo(
          jobId,
          { audioPath, imagePaths },
          timing,
          plan,
          (stage, progress) => {
            if (stage === "bundling") {
              send({ type: "progress", stage, message: "Preparing the video renderer (slow the first time)…" });
            } else if (stage === "queued") {
              send({ type: "progress", stage, message: "Waiting for renderer…" });
            } else {
              const pct = Math.floor((progress ?? 0) * 100);
              if (pct !== lastPct) {
                lastPct = pct;
                send({ type: "progress", stage, message: "Rendering video…", progress: progress ?? 0 });
              }
            }
          },
        );

        const file = path.basename(output);
        send({
          type: "done",
          url: `/api/renders/${file}`,
          downloadUrl: `/api/renders/${file}?download=1`,
          durationInSeconds: timing.durationInSeconds,
          words: timing.words,
          cues: timing.cues.length,
          niche: plan.niche,
          provider: timing.provider,
        });
      } catch (err) {
        console.error(`[generate ${jobId}]`, err);
        send({ type: "error", message: toUserMessage(err) });
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
