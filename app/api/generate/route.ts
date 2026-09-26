import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { denyWithoutAccess } from "@/lib/access";
import { readImageAspect } from "@/lib/image-size";
import {
  checkAudio,
  checkImages,
  checkMediaUrls,
  checkMusic,
  checkTranscript,
  computeTiming,
  downloadBlob,
  isFile,
  isMusicUrl,
  parseCaptionStyle,
  parseImageStats,
  parseMusicVolume,
  parseNiche,
  parseTiming,
  saveUpload,
  toUserMessage,
} from "@/lib/pipeline";
import { pruneOldRenders, renderVideo } from "@/lib/render";
import { buildVideoProps, NEUTRAL_IMAGE_STATS, planStyle } from "@/lib/style";
import type { GenerateEvent, ImageStats, Timing } from "@/lib/types";

// Rendering launches headless Chromium + ffmpeg (locally) or drives a Vercel
// Sandbox (on Vercel): either way it needs the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const badRequest = (message: string) => Response.json({ type: "error", message }, { status: 400 });

type Job = {
  transcript: string;
  imageCount: number;
  previewTiming: Timing | null;
  niche: ReturnType<typeof parseNiche>;
  caption: ReturnType<typeof parseCaptionStyle>;
  imageStats: (ImageStats | null)[];
  musicVolume: number;
} & (
  | { kind: "upload"; audio: File; images: File[]; music: File | null }
  | { kind: "blob"; audioUrl: string; imageUrls: string[]; musicUrl: string | null }
);

/** Parse either multipart (local) or JSON with Vercel Blob URLs (Vercel). */
async function readJob(req: Request): Promise<Job | Response> {
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const b = (await req.json()) as Record<string, unknown>;
      const imageUrls = Array.isArray(b.imageUrls) ? b.imageUrls : [];
      const transcript = String(b.transcript ?? "").trim();
      const problem =
        checkMediaUrls(b.audioUrl, imageUrls) ??
        checkTranscript(transcript) ??
        (b.musicUrl && !isMusicUrl(b.musicUrl) ? "Background music must be an MP3, WAV or M4A file." : null);
      if (problem) return badRequest(problem);
      return {
        kind: "blob",
        audioUrl: b.audioUrl as string,
        imageUrls: imageUrls as string[],
        musicUrl: isMusicUrl(b.musicUrl) ? b.musicUrl : null,
        musicVolume: parseMusicVolume(b.musicVolume),
        transcript,
        imageCount: imageUrls.length,
        previewTiming: parseTiming(b.timing ? JSON.stringify(b.timing) : null, imageUrls.length),
        niche: parseNiche(b.niche),
        caption: parseCaptionStyle(b.captionStyle),
        imageStats: parseImageStats(JSON.stringify(b.imageStats ?? null), imageUrls.length),
      };
    }
    const form = await req.formData();
    const audio = form.get("audio");
    const transcript = String(form.get("transcript") ?? "").trim();
    const images = form.getAll("images").filter(isFile);
    const music = form.get("music");
    const problem = checkAudio(audio) ?? checkTranscript(transcript) ?? checkImages(images) ?? checkMusic(music);
    if (problem) return badRequest(problem);
    return {
      kind: "upload",
      audio: audio as File,
      images,
      music: isFile(music) ? music : null,
      musicVolume: parseMusicVolume(form.get("musicVolume")),
      transcript,
      imageCount: images.length,
      previewTiming: parseTiming(form.get("timing") as string | null, images.length),
      niche: parseNiche(form.get("niche")),
      caption: parseCaptionStyle(form.get("captionStyle")),
      imageStats: parseImageStats(form.get("imageStats") as string | null, images.length),
    };
  } catch {
    return badRequest("The upload couldn't be read. Try again, and check the files aren't too large.");
  }
}

export async function POST(req: Request) {
  const denied = denyWithoutAccess(req);
  if (denied) return denied;
  const job = await readJob(req);
  if (job instanceof Response) return job;

  const jobId = randomUUID();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-video-"));

  // ---- Run the pipeline, streaming progress as newline-delimited JSON. ----
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: GenerateEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      let lastPct = -1;
      try {
        let audioPath: string | null = null;
        const getAudio = async () =>
          (audioPath ??=
            job.kind === "blob"
              ? await downloadBlob(job.audioUrl, workDir, "narration", "audio")
              : await saveUpload(job.audio, workDir, "narration"));

        let timing = job.previewTiming;
        if (!timing) {
          send({ type: "progress", stage: "transcribing", message: "Transcribing audio for word timing…" });
          timing = await computeTiming(await getAudio(), job.transcript, job.imageCount, workDir);
        }
        const t = timing;
        // Same pure planner the browser preview uses, so the render matches it.
        const planFor = (imageStats: (ImageStats | null)[]) =>
          planStyle({ niche: job.niche ?? t.detected.niche, caption: job.caption, timing: t, imageStats });
        const meta = {
          durationInSeconds: t.durationInSeconds,
          words: t.words,
          cues: t.cues.length,
          provider: t.provider,
        };

        if (job.kind === "blob") {
          // Vercel: render in a Sandbox straight from the Blob URLs, detached.
          const plan = planFor(job.imageStats);
          const inputProps = buildVideoProps(
            t,
            plan,
            job.audioUrl,
            job.imageUrls,
            job.musicUrl ? { src: job.musicUrl, volume: job.musicVolume } : null,
          );
          const { startSandboxRender } = await import("@/lib/sandbox-render");
          const ids = await startSandboxRender(jobId, inputProps, plan, (message, progress) =>
            send({ type: "progress", stage: "bundling", message, progress }),
          );
          send({ type: "detached", ...ids, ...meta, niche: plan.niche });
          return;
        }

        // Local: render on this machine.
        pruneOldRenders();
        const audio = await getAudio();
        const imagePaths: string[] = [];
        for (const [i, img] of job.images.entries()) imagePaths.push(await saveUpload(img, workDir, `image-${i + 1}`));
        // Without browser-measured stats (e.g. API use), still detect portrait
        // images from their headers so they're shown whole rather than cropped.
        const imageStats = job.imageStats.map((s, i) => {
          if (s) return s;
          const aspect = readImageAspect(imagePaths[i]);
          return aspect ? { ...NEUTRAL_IMAGE_STATS, aspect } : null;
        });
        const plan = planFor(imageStats);
        const music = job.music
          ? { path: await saveUpload(job.music, workDir, "music"), volume: job.musicVolume }
          : null;
        const output = await renderVideo(jobId, { audioPath: audio, imagePaths, music }, t, plan, (stage, progress) => {
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
        });

        const file = path.basename(output);
        send({
          type: "done",
          url: `/api/renders/${file}`,
          downloadUrl: `/api/renders/${file}?download=1`,
          ...meta,
          niche: plan.niche,
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
