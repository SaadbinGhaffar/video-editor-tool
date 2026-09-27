# Auto Video Editor

Upload **narration audio + its transcript + 2–10 images or video clips**, click one button,
and download a **1920×1080 H.264 MP4**. The video has word-timed captions in your exact
wording, Ken Burns motion on each image, and transitions, colour grading, effects and a
caption style matched to the **niche** of the narration (fitness, tech, travel, documentary…).

**Video clips** (MP4, MOV or WebM, up to 100 MB each; 5–10 s clips work best) can be mixed
freely with images. They play muted under the narration. A clip shorter than its slot plays in
gentle slow motion (down to 0.6×) and then loops; a longer one is cut at the slot's end.

**Video effect** (optional) puts one finishing look over the whole video: **Cinematic**
(teal-and-orange grade, 2.39:1 bars), **Vintage film** (faded stock, grain, flicker, dust, gate
weave), **Black & white**, **Dreamy glow** (highlight bloom, light leaks) or **VHS retro**
(colour fringing, scanlines, tracking glitches). It replaces the niche's grade and finishing
layers; the niche's transitions, motion and captions stay. Defined in `lib/videoEffects.ts`
and drawn by `remotion/videoEffects.tsx`. Each adds roughly 10–35% to render time.

**Preview** (optional) runs only the timing step. It then plays the exact composition
in-browser with `@remotion/player`, using your local files. Changing the style, the caption
look, or the image order updates the preview instantly. **Render MP4** reuses the preview's
timing, so the file matches what you saw.

**Background music** (optional) is a clip, ideally 30–60 s, that plays under the narration
for the whole video. It loops if it's shorter than the video and is trimmed if it's longer. It
fades in and out, and automatically dips to 40% while you speak so the voice stays clear.
Its level has a slider.

**Captions** come in 8 styles, shown in the page as live samples in their real fonts:

| Style | Font |
|---|---|
| Bold | Montserrat Black |
| Classic YouTube | Anton |
| Clean | Inter ExtraBold |
| Impact | Bebas Neue |
| Tech | Space Grotesk Bold |
| Cinematic | Merriweather Black |
| Playful | Bangers |
| Warm | Poppins ExtraBold |

All are Google Fonts. The renderer waits for the font file before drawing any frame, so a
render never falls back to a system font.

## Setup

```bash
npm install
cp .env.example .env.local   # then set OPENAI_API_KEY (optional, see below)
npm run build && npm start   # or: npm run dev
```

Open http://localhost:3000.

### Speech-to-text

Word timing comes from the audio, never from the transcript:

- **OpenAI Whisper** (`whisper-1`, word timestamps) is used when `OPENAI_API_KEY` is set.
  The transcript is passed as a prompt hint. Upload limit is 25 MB, so use MP3 for long narrations.
- **Groq Whisper** (`whisper-large-v3-turbo`) is used instead when only `GROQ_API_KEY` is set.
  Same API and the same 25 MB limit on the free tier.
- **Local whisper.cpp** is the fallback when no key is set. Install it once with
  `npm run setup:whisper`, which downloads the binary plus the `base.en` model (~150 MB)
  into `.whisper/`. On Linux this compiles whisper.cpp, so it needs `make` and a C compiler.

On the first render, Remotion downloads Chrome Headless Shell (~110 MB) into
`node_modules/.remotion`. After that it's cached.

## Niche-aware styling

`lib/niche.ts` detects the niche from the transcript's vocabulary. It's an offline keyword
classifier that gives the same result every time, and the UI shows the words it matched.
With `OPENAI_API_KEY` or `GROQ_API_KEY` set, `lib/niche-llm.ts` asks an LLM instead (model
`NICHE_MODEL`, default `gpt-4.1-mini` on OpenAI or `qwen/qwen3.8-27b` on Groq) and falls back to
keywords on any error. The user can always override the result from the **Style** dropdown.

`lib/style.ts` → `planStyle()` turns the niche into a full style plan. It's a pure,
seeded function that the browser and server both call, so preview and render always match.

| Niche | Transitions | Look | Captions |
|---|---|---|---|
| Tech & AI | glitch, zoom-through, whip, slide | cool tint, contrast, light grain | Space Grotesk, cyan |
| Travel & nature | fade, zoom-through, slide, iris | warm, vivid, light leaks | Montserrat, yellow |
| Business & education | push, slide, wipe, fade | clean, minimal | Inter on a panel, boxed word |
| Fitness & motivation | whip, white flash, zoom, push | high contrast, punch-in on each image | Bebas Neue caps, red |
| Food & lifestyle | fade, zoom, iris, slide | warm, saturated, soft leaks | Poppins, orange |
| Gaming & entertainment | glitch, whip, flash, flip | very saturated, purple tint | Bangers caps, boxed green |
| Documentary & story | dip-to-black, fade, wipe | desaturated sepia, heavy grain, vignette, letterbox | Merriweather serif, gold |
| General | fade, slide, zoom, wipe | neutral | Montserrat, yellow |

The plan also adapts to the actual inputs:

- **Speaking pace.** Faster speech gets snappier transitions and slower speech gets longer
  ones, using words per minute from the audio.
- **Each image.** Its brightness, saturation and shape are measured in the browser.
  `lib/image-size.ts` reads headers as a server-side fallback and handles EXIF rotation.
  Dark photos are lifted and dull ones get a little colour back. Portrait or square photos
  are shown whole over a blurred backdrop instead of being cropped.
- **Scene length.** Transitions never take more than 40% of the shortest image's time, so
  10 images on a short clip still work.

The composition is in `remotion/`. The pieces:

- **Transitions:** Remotion's CSS transitions (fade, slide, wipe, flip, iris, push-cut) plus
  custom CSS ones in `customTransitions.tsx` (zoom-through, whip-pan, glitch, flash,
  dip-to-black). They don't use WebGL, so they look identical in the preview and the render.
- **Effects:** `effects.tsx` covers tint, light leaks, vignette, grain and letterbox;
  `videoEffects.tsx` adds the whole-video looks (SVG colour filters, film dust, scanlines).
- **Clips:** `SceneVideo.tsx` plays each clip with `OffthreadVideo`, slowed or looped to fit.
- **Captions:** seven caption looks in `Captions.tsx`.

`npm run remotion:studio` previews the composition with sample props.

## How it works

`POST /api/timing` handles the preview. It transcribes, aligns, detects the niche and plans
scenes, then returns JSON; the images stay in the browser. `POST /api/generate` runs the
full pipeline and streams progress as NDJSON. If the browser sends the preview's `timing`,
it's validated and reused.

1. **Validate** the audio (MP3/WAV/M4A), the transcript (non-empty) and 2–10 images
   (JPG/PNG/WebP, ≤ 25 MB each) or clips (MP4/MOV/M4V/WebM, ≤ 100 MB each). Each needs at
   least ~1.2 s on screen; if there are too many for the narration's length, the error says
   how many fit. Clip lengths come from the browser, or are read from the file if missing.
2. **Transcribe** with word timestamps (`lib/stt.ts`). Niche detection runs in parallel.
3. **Find the real speech bounds** from the signal's loudness (`lib/audio.ts`).
   Recognizers are unreliable at the edges; whisper.cpp stamps the first word at 0 s even
   after silence. These bounds are used to trim dead air at both ends and to stop the
   first caption appearing early. A partial transcript never truncates spoken audio.
4. **Align** (`lib/align.ts`). A Needleman-Wunsch alignment runs between the transcript
   words and the recognized words. Close matches take the recognizer's timing directly, and
   unmatched transcript words are spread over the gap between their matched neighbours.
   Fillers the recognizer heard but the transcript omits ("um") are dropped.
5. **Group cues** of 1–4 words, breaking on punctuation and pauses, with no lone word left
   dangling. **Plan scenes** by snapping each cut to a nearby sentence break.
6. **Render** (`lib/render.ts`). The Remotion bundle is built once per server process into
   `.remotion-bundle/`, and renders run one at a time. CRF is 20, rising slightly for grainy
   styles so file sizes stay sensible. Finished MP4s older than 24 h are pruned, and temp
   files are deleted after each job.
7. **Serve.** `GET /api/renders/<id>.mp4` streams the result (with Range support).
   `?download=1` makes it an attachment.

## Tests

```bash
npm test             # alignment, cue grouping, scene cuts, niche detection, style planning
npm run typecheck
```

## Deploying

### Vercel

On Vercel (detected via the `VERCEL` env var) the app switches to a serverless-friendly flow:

- **Uploads** go from the browser straight to **Vercel Blob** (`/api/upload` issues client
  tokens), because Functions only accept ~4.5 MB request bodies.
- **Transcription** needs **`OPENAI_API_KEY`** or **`GROQ_API_KEY`**, since local whisper.cpp can't run in a Function.
- **Rendering** runs in **Vercel Sandbox** through `@remotion/vercel`. The Remotion bundle
  is prebuilt during `vercel-build` (`remotion-build/`) and uploaded into a sandbox, which
  renders detached and uploads the MP4 to Blob. The page polls `/api/render-progress`.
  The first render sets up a sandbox (system libraries, Chrome), which takes a few minutes,
  and saves a **snapshot**. Every later render boots from the snapshot in seconds.
- **Cleanup:** a daily cron (`/api/cleanup`, protected by `CRON_SECRET`) deletes uploads and
  renders older than 24 h.

Setup:

1. Import the GitHub repo in Vercel (or run `vercel` from this folder).
2. **Storage → Create → Blob** with **public** access, connected to the project. This adds
   `BLOB_READ_WRITE_TOKEN`. The render machine loads media by URL, so the store must be
   public. File URLs are unguessable and deleted after 24 h.
3. Add environment variables:
   - `OPENAI_API_KEY` or `GROQ_API_KEY` (one is required)
   - `APP_ACCESS_KEY` (strongly recommended: without it, anyone with the URL can run
     renders on your account)
   - `CRON_SECRET` (any random string)
   - optionally `SANDBOX_VCPUS` (default 4) and `SANDBOX_MAX_MINUTES` (default 45), and `NICHE_MODEL`
4. Redeploy. Sandbox, Blob and OpenAI usage are billed to your accounts.

**Render time limits.** A render runs in one sandbox session, at about 1 frame/s per vCPU
for 1080p with clips and an effect (a 5-minute video ≈ 35–40 min on 4 vCPUs). The defaults fit
the **Hobby** plan (max 4 vCPUs, 45-minute sessions), which allows videos up to about
5 min 20 s; longer ones are refused up front, and the page shows the limit and an estimated
render time. Hobby also includes only **5 Sandbox CPU-hours a month**, and a 5-minute render
uses about 2.5 of them. On **Pro**, set `SANDBOX_VCPUS=8` and e.g. `SANDBOX_MAX_MINUTES=120`
for roughly twice the speed and longer videos (billed at about $0.13 per CPU-hour).

### Your own server

Anywhere else the app renders locally with `@remotion/renderer`. That needs a long-running
Node process with a few GB of RAM, for example Railway, Render, Fly.io or a VPS
(`npm run build && npm start`); make sure any reverse proxy allows long requests. On an
8-core laptop, rendering runs at roughly 6–10 frames/s depending on the style's effects, so a
30 s clip takes ~2–3 minutes. On Linux, Chromium needs the usual shared libraries. See
https://www.remotion.dev/docs/miscellaneous/linux-dependencies.
