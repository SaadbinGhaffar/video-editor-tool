"use client";

import dynamic from "next/dynamic";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ANIMATION_SHARES,
  DEFAULT_ANIMATION_SHARE,
  MAX_ANIMATION_DATA_CHARS,
  MIN_ANIMATED_VIDEO_SECONDS,
} from "@/lib/animation";
import { detectNicheFromText, NICHE_LABELS } from "@/lib/niche";
import { estimateRenderMinutes } from "@/lib/renderBudget";
import { buildVideoProps, NICHE_PRESETS, planStyle } from "@/lib/style";
import {
  DEFAULT_MUSIC_VOLUME,
  MAX_IMAGES,
  MIN_IMAGES,
  NICHES,
  FORMAT_SIZE,
  VIDEO_EFFECTS,
  VIDEO_FORMATS,
  type CaptionStyleId,
  type GenerateEvent,
  type ImageStats,
  type NicheId,
  type PipelineStage,
  type Timing,
  type VideoEffectId,
  type VideoFormat,
} from "@/lib/types";
import { effectLook } from "@/lib/videoEffects";
import { CaptionStylePicker } from "./CaptionStylePicker";
import { ImageGallery, type ImageItem } from "./ImageGallery";
import { MusicInput, type MusicChoice } from "./MusicInput";
import { SeoPanel } from "./SeoPanel";
import { measureImage } from "./imageStats";
import { accessHeaders, loadAccessKey, pollRender, saveAccessKey, uploadToBlob, type AppConfig } from "./transport";

// The Remotion player only runs in the browser.
const PreviewPlayer = dynamic(() => import("./PreviewPlayer"), {
  ssr: false,
  loading: () => <div className="player-placeholder">Loading preview…</div>,
});

/** A finished render, with the transcript it was made from (for the SEO text). */
type Done = Extract<GenerateEvent, { type: "done" }> & { transcript: string; format: VideoFormat };
type Busy = null | "preview" | "render";

const STEPS: { stage: PipelineStage; label: string }[] = [
  { stage: "upload", label: "Upload files" },
  { stage: "transcribing", label: "Transcribe audio and align your transcript" },
  { stage: "bundling", label: "Prepare the renderer" },
  { stage: "rendering", label: "Render the MP4" },
];
const FORMAT_LABELS: Record<VideoFormat, { title: string; detail: string }> = {
  landscape: { title: "YouTube video", detail: "16:9 · 1920×1080" },
  shorts: { title: "YouTube Shorts", detail: "9:16 · 1080×1920 · Shorts can be up to 3 min" },
};

const stepIndex = (s: PipelineStage) => STEPS.findIndex((x) => x.stage === (s === "queued" ? "bundling" : s));

/** Identifies the inputs timing was computed from, so we know when it's stale. */
const timingKey = (audio: File | null, transcript: string, imageCount: number, animation: string | null) =>
  audio
    ? `${audio.name}:${audio.size}:${audio.lastModified}|${imageCount}|${transcript.trim()}|${animation === null ? "" : `anim:${animation.trim()}`}`
    : "";

async function readError(res: Response) {
  const data = await res.json().catch(() => null);
  return data?.message ?? `The server returned an error (${res.status}).`;
}

let nextImageId = 1;

export default function Home() {
  const [audio, setAudio] = useState<{ file: File; url: string } | null>(null);
  const [transcript, setTranscript] = useState("");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [nicheChoice, setNicheChoice] = useState<NicheId | "auto">("auto");
  const [captionChoice, setCaptionChoice] = useState<CaptionStyleId | "auto">("auto");
  const [effect, setEffect] = useState<VideoEffectId>("none");
  const [format, setFormat] = useState<VideoFormat>("landscape");
  const [music, setMusic] = useState<MusicChoice | null>(null);
  const [musicVolume, setMusicVolume] = useState(DEFAULT_MUSIC_VOLUME);
  const [animated, setAnimated] = useState(true);
  const [animationData, setAnimationData] = useState("");
  const [animationShare, setAnimationShare] = useState<number>(DEFAULT_ANIMATION_SHARE);
  // Remember the animation settings, so a page reload doesn't quietly switch them off.
  const settingsLoaded = useRef(false);
  useEffect(() => {
    if (settingsLoaded.current) saveAnimationSettings({ animated, share: animationShare, data: animationData });
  }, [animated, animationShare, animationData]);
  const [busy, setBusy] = useState<Busy>(null);
  const [stage, setStage] = useState<PipelineStage>("upload");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Done | null>(null);
  const [timing, setTiming] = useState<{ key: string; value: Timing } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [accessKey, setAccessKey] = useState("");

  useEffect(() => {
    setAccessKey(loadAccessKey());
    const saved = loadAnimationSettings();
    if (saved) {
      setAnimated(saved.animated);
      setAnimationShare(saved.share);
      setAnimationData(saved.data);
    }
    settingsLoaded.current = true;
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: AppConfig) => setConfig(c))
      .catch(() => setConfig(null));
  }, []);

  const currentKey = timingKey(
    audio?.file ?? null,
    transcript,
    images.length,
    animated ? `${animationShare}|${animationData}` : null,
  );
  const freshTiming = timing && timing.key === currentKey ? timing.value : null;
  // Vercel: estimated render time for the current video.
  const renderMinutes =
    freshTiming && config?.renderBudget
      ? Math.max(1, Math.round(estimateRenderMinutes(freshTiming.durationInSeconds, config.renderBudget)))
      : null;

  // Live keyword guess while typing; replaced by the server's detection after a preview.
  const deferredTranscript = useDeferredValue(transcript);
  const liveDetection = useMemo(() => detectNicheFromText(deferredTranscript), [deferredTranscript]);
  const detection = freshTiming?.detected ?? liveDetection;
  const niche: NicheId = nicheChoice === "auto" ? detection.niche : nicheChoice;
  const captionStyle: CaptionStyleId = captionChoice === "auto" ? NICHE_PRESETS[niche].caption : captionChoice;

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // Revoke object URLs when the page goes away.
  const latest = useRef({ audio, images });
  latest.current = { audio, images };
  useEffect(
    () => () => {
      if (latest.current.audio) URL.revokeObjectURL(latest.current.audio.url);
      latest.current.images.forEach((i) => URL.revokeObjectURL(i.url));
    },
    [],
  );

  function chooseAudio(file: File | null) {
    setAudio((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return file ? { file, url: URL.createObjectURL(file) } : null;
    });
  }

  function addImages(files: File[]) {
    const room = MAX_IMAGES - images.length;
    const accepted = files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name) || /^image\/(jpeg|png|webp)$/.test(f.type));
    const skipped = files.length - accepted.length;
    const toAdd = accepted.slice(0, Math.max(0, room));
    const problems: string[] = [];
    if (skipped) problems.push(`${skipped} file(s) skipped: only JPG, PNG or WebP images are supported.`);
    if (accepted.length > toAdd.length) problems.push(`Only ${MAX_IMAGES} images are allowed; the extra ones were not added.`);
    setError(problems.length ? problems.join(" ") : null);

    const items: ImageItem[] = toAdd.map((file) => ({
      id: nextImageId++,
      file,
      url: URL.createObjectURL(file),
      stats: null,
    }));
    setImages((prev) => [...prev, ...items]);
    // Measure colours in the background; the grade uses them once ready.
    for (const item of items) {
      measureImage(item.file).then((stats: ImageStats | null) =>
        setImages((prev) => prev.map((p) => (p.id === item.id ? { ...p, stats } : p))),
      );
    }
  }

  function removeImage(id: number) {
    setImages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  function checkInputs(): boolean {
    let problem: string | null = null;
    if (!audio) problem = "Please add your narration audio file.";
    else if (!transcript.trim()) problem = "Please paste the transcript of your narration.";
    else if (images.length < MIN_IMAGES) problem = `Please add at least ${MIN_IMAGES} images.`;
    setError(problem);
    return problem === null;
  }

  function begin(kind: Exclude<Busy, null>, msg: string) {
    setBusy(kind);
    setStage("upload");
    setMessage(msg);
    setProgress(null);
    startedAt.current = Date.now();
    setElapsed(0);
  }

  function fail(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    setError(msg === "Failed to fetch" ? "Couldn't reach the server. Is it still running?" : msg);
  }

  /** Vercel mode: put the audio (and optionally images) in Blob storage first. */
  async function uploadMedia(withImages: boolean) {
    if (!audio) throw new Error("Please add your narration audio file.");
    const extra = withImages ? images.map((i) => i.file) : [];
    const musicFile = withImages && music ? music.file : null;
    const files = [audio.file, ...extra, ...(musicFile ? [musicFile] : [])];
    const total = files.reduce((n, f) => n + f.size, 0);
    const loaded = new Map<File, number>();
    const track = (f: File) => (n: number) => {
      loaded.set(f, n);
      const done = [...loaded.values()].reduce((a, b) => a + b, 0);
      setMessage(`Uploading files… ${Math.round((done / Math.max(total, 1)) * 100)}%`);
    };
    const urls = await Promise.all(
      files.map((f, i) =>
        uploadToBlob(f, i === 0 ? "audio" : f === musicFile ? "music" : "image", accessKey, track(f)),
      ),
    );
    return {
      audioUrl: urls[0],
      imageUrls: urls.slice(1, 1 + extra.length),
      musicUrl: musicFile ? urls[urls.length - 1] : null,
    };
  }

  const transcribingMessage = animated
    ? "Transcribing audio and designing the animated segments…"
    : "Transcribing audio and aligning your transcript…";

  async function onPreview() {
    if (!checkInputs() || !audio) return;
    const key = currentKey;
    begin("preview", "Uploading audio…");
    try {
      let res: Response;
      if (config?.mode === "vercel") {
        const { audioUrl } = await uploadMedia(false);
        setStage("transcribing");
        setMessage(transcribingMessage);
        res = await fetch("/api/timing", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...accessHeaders(accessKey) },
          body: JSON.stringify({ audioUrl, transcript, imageCount: images.length, animated, animationData, animationShare }),
        });
      } else {
        const body = new FormData();
        body.append("audio", audio.file);
        body.append("transcript", transcript);
        body.append("imageCount", String(images.length));
        if (animated) {
          body.append("animated", "1");
          body.append("animationData", animationData);
          body.append("animationShare", String(animationShare));
        }
        setStage("transcribing");
        setMessage(transcribingMessage);
        res = await fetch("/api/timing", { method: "POST", body, headers: accessHeaders(accessKey) });
      }
      if (!res.ok) throw new Error(await readError(res));
      setTiming({ key, value: (await res.json()) as Timing });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function onRender(e: React.FormEvent) {
    e.preventDefault();
    if (!checkInputs() || !audio) return;
    setResult(null);
    begin("render", "Uploading files…");
    const rendered = { transcript, format };

    const style = {
      niche: nicheChoice,
      captionStyle: captionChoice,
      effect,
      format,
      imageStats: images.map((i) => i.stats),
      musicVolume,
      animated,
      animationData: animated ? animationData : "",
      animationShare,
    };
    try {
      let res: Response;
      if (config?.mode === "vercel") {
        const { audioUrl, imageUrls, musicUrl } = await uploadMedia(true);
        res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...accessHeaders(accessKey) },
          // Reuse the preview's timing so the render matches it and skips transcription.
          body: JSON.stringify({ audioUrl, imageUrls, musicUrl, transcript, ...style, timing: freshTiming }),
        });
      } else {
        const body = new FormData();
        body.append("audio", audio.file);
        body.append("transcript", transcript);
        for (const img of images) body.append("images", img.file);
        body.append("imageStats", JSON.stringify(style.imageStats));
        body.append("niche", style.niche);
        body.append("captionStyle", style.captionStyle);
        body.append("effect", style.effect);
        body.append("format", style.format);
        if (animated) {
          body.append("animated", "1");
          body.append("animationData", animationData);
          body.append("animationShare", String(animationShare));
        }
        if (music) {
          body.append("music", music.file);
          body.append("musicVolume", String(musicVolume));
        }
        if (freshTiming) body.append("timing", JSON.stringify(freshTiming));
        res = await fetch("/api/generate", { method: "POST", body, headers: accessHeaders(accessKey) });
      }
      if (!res.ok || !res.body) throw new Error(await readError(res));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as GenerateEvent;
          if (ev.type === "progress") {
            setStage(ev.stage);
            setMessage(ev.message);
            setProgress(ev.stage === "rendering" ? (ev.progress ?? 0) : null);
          } else if (ev.type === "done") {
            setResult({ ...ev, ...rendered });
            finished = true;
          } else if (ev.type === "detached") {
            // Vercel: the render runs on in a sandbox; follow it by polling.
            setStage("rendering");
            setMessage("Rendering video…");
            setProgress(0);
            const { sandboxId, cmdId, type: _type, ...meta } = ev;
            const out = await pollRender({ sandboxId, cmdId }, accessKey, (msg, p) => {
              setMessage(msg);
              setProgress(p);
            });
            setResult({ type: "done", url: out.url, downloadUrl: out.downloadUrl, ...meta, ...rendered });
            finished = true;
          } else {
            throw new Error(ev.message);
          }
        }
      }
      if (!finished) throw new Error("The connection to the server closed before the video finished. Please try again.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  const previewProps = useMemo(() => {
    if (!freshTiming || !audio) return null;
    if (!freshTiming.scenes.every((s, i) => (s.image ?? i) < images.length)) return null;
    const plan = planStyle({
      niche,
      caption: captionStyle,
      timing: freshTiming,
      imageStats: images.map((i) => i.stats),
      effect,
      format,
    });
    return buildVideoProps(
      freshTiming,
      plan,
      audio.url,
      images.map((i) => i.url),
      music ? { src: music.url, volume: musicVolume } : null,
    );
  }, [freshTiming, audio, images, niche, captionStyle, effect, format, music, musicVolume]);

  const current = stepIndex(stage);
  const animationPlan = freshTiming?.animation
    ? `This video: ${freshTiming.animation.segments.length} animated segment${freshTiming.animation.segments.length === 1 ? "" : "s"} (${freshTiming.animation.segments
        .map((s) => `${formatTime(Math.round(s.start))}–${formatTime(Math.round(s.end))}`)
        .join(", ")}), designed ${freshTiming.animation.source === "llm" ? "by AI" : "offline (no AI key)"}.`
    : null;
  const detectedLabel =
    detection.niche === "general" ? "General (no clear niche)" : NICHE_LABELS[detection.niche];

  return (
    <main>
      <h1>Auto Video Editor</h1>
      <p className="lede">
        Upload your narration, its transcript and {MIN_IMAGES}–{MAX_IMAGES} images. The style (transitions, colour,
        effects, captions) is matched to your topic automatically. Preview it here, then render a 1920×1080 video or a vertical 1080×1920 Short.
      </p>

      <form onSubmit={onRender}>
        {config?.accessKeyRequired ? (
          <div className="field">
            <label htmlFor="access-key">Access key</label>
            <input
              id="access-key"
              type="password"
              className="text"
              value={accessKey}
              autoComplete="current-password"
              onChange={(e) => {
                setAccessKey(e.target.value);
                saveAccessKey(e.target.value);
              }}
              disabled={!!busy}
            />
            <p className="hint">This deployment is private. The key is remembered in this browser.</p>
          </div>
        ) : null}
        {config?.mode === "vercel" && (!config.blobConfigured || !config.transcriptionConfigured) ? (
          <div className="error" role="alert">
            Setup incomplete:{" "}
            {[
              !config.blobConfigured && "connect a Vercel Blob store to this project",
              !config.transcriptionConfigured && "add an OPENAI_API_KEY or GROQ_API_KEY environment variable",
            ]
              .filter(Boolean)
              .join(" and ")}
            , then redeploy.
          </div>
        ) : null}
        <div className="field">
          <span className="label">Format</span>
          <div className="format-picker" role="radiogroup" aria-label="Format">
            {VIDEO_FORMATS.map((f) => (
              <button
                type="button"
                key={f}
                role="radio"
                aria-checked={format === f}
                className={`format-card${format === f ? " selected" : ""}`}
                onClick={() => setFormat(f)}
                disabled={!!busy}
              >
                <span className={`format-shape ${f}`} aria-hidden />
                <span className="format-text">
                  <strong>{FORMAT_LABELS[f].title}</strong>
                  <span>{FORMAT_LABELS[f].detail}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="audio">1. Narration audio</label>
          <input
            id="audio"
            type="file"
            accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a"
            onChange={(e) => chooseAudio(e.target.files?.[0] ?? null)}
            disabled={!!busy}
          />
          <p className="hint">MP3, WAV or M4A. Silence at the start and end is trimmed automatically.</p>
        </div>

        <div className="field">
          <label htmlFor="transcript">2. Transcript</label>
          <textarea
            id="transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste exactly what you say in the recording…"
            disabled={!!busy}
          />
          <p className="hint">Captions use this exact wording. Timing is taken from the audio automatically.</p>
        </div>

        <div className="field">
          <span className="label">
            3. Images ({MIN_IMAGES}–{MAX_IMAGES})
          </span>
          <ImageGallery
            format={format}
            images={images}
            onAdd={addImages}
            onRemove={removeImage}
            onReorder={setImages}
            disabled={!!busy}
          />
        </div>

        <div className="field style-single">
          <div>
            <label htmlFor="niche">Style</label>
            <select
              id="niche"
              value={nicheChoice}
              onChange={(e) => setNicheChoice(e.target.value as NicheId | "auto")}
              disabled={!!busy}
            >
              <option value="auto">Auto: {detectedLabel}</option>
              {NICHES.map((n) => (
                <option key={n} value={n}>
                  {NICHE_LABELS[n]}
                </option>
              ))}
            </select>
            <p className="hint">
              {nicheChoice === "auto"
                ? detection.signals.length
                  ? `${detection.source === "llm" ? "AI" : "Detected from"}: ${detection.signals.join(", ")}`
                  : "Detected from the transcript's topic."
                : "Manual choice."}
            </p>
          </div>
        </div>

        <div className="field style-single">
          <label htmlFor="effect">Video effect</label>
          <select
            id="effect"
            value={effect}
            onChange={(e) => setEffect(e.target.value as VideoEffectId)}
            disabled={!!busy}
          >
            {VIDEO_EFFECTS.map((id) => (
              <option key={id} value={id}>
                {effectLook(id)?.label ?? "None (use the style's own look)"}
              </option>
            ))}
          </select>
          <p className="hint">
            {effectLook(effect)
              ? `${effectLook(effect)!.description} Applied to the whole video, over the style's transitions and motion.`
              : "Pick a finishing look for the whole video: Cinematic, Vintage film, Black & white, Dreamy glow or VHS retro."}
          </p>
        </div>

        <div className="field">
          <span className="label">Caption style</span>
          <CaptionStylePicker
            value={captionChoice}
            autoStyle={NICHE_PRESETS[niche].caption}
            onChange={setCaptionChoice}
            disabled={!!busy}
          />
          <p className="hint">Changing the style or captions updates the preview instantly.</p>
        </div>

        <div className="field">
          <span className="label">4. Animated segments (optional)</span>
          <label className="check">
            <input type="checkbox" checked={animated} onChange={(e) => setAnimated(e.target.checked)} disabled={!!busy} />
            Mix animated chunks in between the photos
          </label>
          <p className="hint">
            Cinematic motion graphics (about 40 s each) spread through the whole video, with photos before, between and
            after them: your words slamming onto the screen as you say them, over your own photos with moving camera,
            particles and light streaks, plus giant counters, day-streak calendars, charts and split screens whenever
            you talk numbers. Needs at least {MIN_ANIMATED_VIDEO_SECONDS} s of narration.
          </p>
          {animated ? (
            <>
              <label htmlFor="animation-share" className="sublabel">
                How much of the video is animated
              </label>
              <select
                id="animation-share"
                className="share-select"
                value={animationShare}
                onChange={(e) => setAnimationShare(Number(e.target.value))}
                disabled={!!busy}
              >
                {ANIMATION_SHARES.map((share) => (
                  <option key={share} value={share}>
                    {shareLabel(share)}
                  </option>
                ))}
              </select>
              <p className="hint">{shareExample(animationShare)}</p>
              <label htmlFor="animation-data" className="sublabel">
                Data for the animations (optional)
              </label>
              <textarea
                id="animation-data"
                className="short"
                value={animationData}
                maxLength={MAX_ANIMATION_DATA_CHARS}
                onChange={(e) => setAnimationData(e.target.value)}
                placeholder={ANIMATION_DATA_EXAMPLE}
                disabled={!!busy}
              />
              <p className="hint">
                Facts, figures and lists to show when the narration talks about them. Lines like “2023: 14” become
                bar charts. Numbers are only ever taken from here or from your narration, never made up.
                {animationPlan ? ` ${animationPlan}` : ""}
              </p>
            </>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="music">5. Background music (optional)</label>
          <MusicInput
            music={music}
            volume={musicVolume}
            onChange={setMusic}
            onVolume={setMusicVolume}
            videoDuration={freshTiming?.durationInSeconds ?? null}
            disabled={!!busy}
          />
        </div>

        <div className="actions">
          <button type="button" className="secondary" onClick={onPreview} disabled={!!busy}>
            {busy === "preview" ? "Preparing preview…" : freshTiming ? "Refresh preview" : "Preview"}
          </button>
          <button type="submit" disabled={!!busy}>
            {busy === "render" ? "Rendering…" : "Render MP4"}
          </button>
        </div>
        <p className="hint">
          Preview plays in your browser in a few seconds. Render makes the downloadable file
          {renderMinutes ? ` (up to about ${renderMinutes} min for this video).` : " (a minute or more)."}
        </p>

        {busy === "preview" ? (
          <div className="status" role="status" aria-live="polite">
            <strong>{message}</strong> ({formatTime(elapsed)} elapsed)
            <div className="hint">Usually a few seconds, longer for long recordings.</div>
          </div>
        ) : null}

        {busy === "render" ? (
          <div className="status" role="status" aria-live="polite">
            <div>
              <strong>{message}</strong> ({formatTime(elapsed)} elapsed)
            </div>
            <div className="hint">
              {renderMinutes
                ? `Estimated render time: up to about ${renderMinutes} min. Keep this tab open.`
                : "This usually takes one to a few minutes depending on the audio length. Keep this tab open."}
            </div>
            {stage === "rendering" && progress !== null ? (
              <progress value={progress} max={1} aria-label="Render progress" />
            ) : null}
            <ol>
              {STEPS.map((s, i) => (
                <li key={s.stage} className={i < current ? "finished" : i === current ? "current" : ""}>
                  {s.stage === "rendering" ? `Render ${FORMAT_SIZE[format].width}×${FORMAT_SIZE[format].height} MP4` : s.label}
                  {i < current ? (s.stage === "transcribing" && freshTiming ? " ✓ (from preview)" : " ✓") : ""}
                  {i === current && s.stage === "rendering" && progress !== null
                    ? ` — ${Math.round(progress * 100)}%`
                    : ""}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {error ? (
          <div className="error" role="alert">
            {error}
          </div>
        ) : null}
      </form>

      {previewProps && freshTiming ? (
        <section className="result">
          <h2>Preview</h2>
          <PreviewPlayer inputProps={previewProps} />
          {freshTiming.animation ? (
            <TimelineBar duration={freshTiming.durationInSeconds} segments={freshTiming.animation.segments} />
          ) : null}
          <p className="hint">
            {NICHE_LABELS[niche]} style · {formatTime(Math.round(freshTiming.durationInSeconds))} ·{" "}
            {freshTiming.words} words · {freshTiming.cues.length} captions · {freshTiming.wpm} words/min
            {freshTiming.audioOffset > 0 ? ` · ${freshTiming.audioOffset.toFixed(1)} s of leading silence trimmed` : ""}
            . Swapping, reordering or restyling updates it instantly; changing the audio, transcript, number of
            images or animated segments needs a refresh.
          </p>
        </section>
      ) : timing ? (
        <p className="hint stale">Inputs changed since the last preview. Click “Refresh preview” to update it.</p>
      ) : null}

      {result ? (
        <section className="result">
          <h2>{result.format === "shorts" ? "Rendered Short" : "Rendered MP4"}</h2>
          <video src={result.url} controls playsInline className={result.format === "shorts" ? "vertical" : undefined} />
          <a className="button" href={result.downloadUrl} download>
            Download MP4
          </a>
          <span className="meta">
            {NICHE_LABELS[result.niche]} style · {formatTime(Math.round(result.durationInSeconds))} · {result.words}{" "}
            words · {result.cues} captions
          </span>
          <SeoPanel
            key={result.url}
            transcript={result.transcript}
            niche={result.niche}
            durationInSeconds={result.durationInSeconds}
            format={result.format}
            accessKey={accessKey}
          />
        </section>
      ) : null}
    </main>
  );
}

const ANIMATION_DATA_EXAMPLE = `For example:
Electric cars sold worldwide (millions)
2020: 3
2022: 10
2023: 14
Top reasons people switch: lower running costs, quieter ride, tax credits`;

const ANIMATION_SETTINGS = "auto-video-editor:animation";

function loadAnimationSettings(): { animated: boolean; share: number; data: string } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(ANIMATION_SETTINGS) ?? "null");
    if (!raw || typeof raw.animated !== "boolean") return null;
    const share = ANIMATION_SHARES.includes(raw.share) ? raw.share : DEFAULT_ANIMATION_SHARE;
    return { animated: raw.animated, share, data: typeof raw.data === "string" ? raw.data : "" };
  } catch {
    return null;
  }
}

function saveAnimationSettings(settings: { animated: boolean; share: number; data: string }) {
  try {
    localStorage.setItem(ANIMATION_SETTINGS, JSON.stringify(settings));
  } catch {
    // Private mode etc.: settings just won't be remembered.
  }
}

/** Where the animated chunks fall in the video, under the preview. */
function TimelineBar({ duration, segments }: { duration: number; segments: { start: number; end: number }[] }) {
  const total = segments.reduce((n, s) => n + s.end - s.start, 0);
  return (
    <div className="timeline">
      <div className="timeline-bar" aria-hidden>
        {segments.map((s, i) => (
          <span
            key={i}
            className="timeline-anim"
            style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }}
          />
        ))}
      </div>
      <p className="hint">
        <span className="timeline-key" /> Animated: {segments.map((s) => `${formatTime(Math.round(s.start))}–${formatTime(Math.round(s.end))}`).join(", ")} (
        {formatTime(Math.round(total))} of {formatTime(Math.round(duration))}). Photos everywhere else.
      </p>
    </div>
  );
}

function shareLabel(share: number) {
  const pct = Math.round(share * 100);
  return share === DEFAULT_ANIMATION_SHARE ? `${pct}% (2 of every 5 minutes, recommended)` : `${pct}%`;
}

/** "In a 5-minute video: 2:00 of animation in 3 chunks…" */
function shareExample(share: number) {
  const animated = 300 * share;
  const chunks = Math.max(1, Math.round(animated / 40));
  return `In a 5-minute video: ${formatTime(Math.round(animated))} of animation in ${chunks} chunks of about ${Math.round(animated / chunks)} s, spread from start to finish. The video always starts and ends on photos.`;
}

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
