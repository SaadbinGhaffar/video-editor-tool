// Checks for niche detection and the style planner: `npm run test:style`
import assert from "node:assert/strict";
import { detectNicheFromText } from "../lib/niche";
import { mediaKindOf } from "../lib/media";
import { buildVideoProps, encoderCrf, planStyle } from "../lib/style";
import { FPS, VIDEO_EFFECTS, type Timing } from "../lib/types";

// 1. Niche detection on clearly-themed scripts.
const samples: [string, string][] = [
  ["fitness", "Today's workout is all about strength. Three sets of squats, ten reps each, then cardio. Push through, never quit, the gym is where discipline is built."],
  ["tech", "This new AI model runs on a laptop GPU. The software is open source, the code is on GitHub, and developers can call the API from Python."],
  ["travel", "We hiked to a hidden waterfall, then spent the sunset on the beach. This island is the best travel destination I've visited all summer."],
  ["food", "This pasta recipe takes ten minutes. Fry the garlic, add the sauce and cheese, and taste that flavor. Dinner is delicious."],
  ["documentary", "In the eighteenth century, the empire was at war. Historians discovered evidence in the archive that the king's death was no accident."],
  ["gaming", "This boss fight in the new RPG is insane. My squad tried ranked multiplayer on console, and the loot was epic."],
  ["business", "Grow revenue by understanding your customer. Marketing and sales strategy matter more than budget for a new entrepreneur."],
  ["general", "Hello and thanks for being here. Let me say a few words about my week."],
];
for (const [expected, text] of samples) {
  const d = detectNicheFromText(text);
  assert.equal(d.niche, expected, `"${text.slice(0, 40)}…" → ${d.niche} (signals ${d.signals.join(",")})`);
}
console.log("ok  niche detection on", samples.length, "samples");

// 2. Style planning.
const timing = (images: number, duration = 30, wpm = 150): Timing => ({
  durationInSeconds: duration,
  audioOffset: 0,
  words: 60,
  wpm,
  provider: "test",
  detected: { niche: "general", confidence: 0, signals: [], source: "keywords" },
  scenes: Array.from({ length: images }, (_, i) => ({ start: (i * duration) / images, end: ((i + 1) * duration) / images })),
  cues: [{ start: 0, end: 1, words: [{ text: "hello", start: 0, end: 1 }] }],
});

{
  const t = timing(10, 20);
  const a = planStyle({ niche: "tech", timing: t, imageStats: Array(10).fill(null) });
  const b = planStyle({ niche: "tech", timing: t, imageStats: Array(10).fill(null) });
  assert.deepEqual(a, b, "deterministic: preview and render must match");
  assert.equal(a.transitions.length, 9);
  for (let i = 1; i < a.transitions.length; i++) assert.notEqual(a.transitions[i], a.transitions[i - 1], "no back-to-back repeats");
  assert.ok(a.transitions.every((k) => ["glitch", "zoom", "whip", "slide"].includes(k)));
  assert.ok(a.transitionFrames % 2 === 0 && a.transitionFrames <= 2 * FPS * 0.4, "transition fits in 2s scenes");
  console.log("ok  deterministic plan, 10 images:", a.transitions.join(" "));
}

{
  const doc = planStyle({ niche: "documentary", timing: timing(3), imageStats: [null, null, null] });
  const fit = planStyle({ niche: "fitness", timing: timing(3), imageStats: [null, null, null] });
  assert.ok(doc.transitionFrames > fit.transitionFrames, "documentary cuts are slower than fitness cuts");
  assert.ok(doc.effects.letterbox && doc.effects.grain > fit.effects.grain);
  assert.equal(doc.caption, "cinematic");
  assert.equal(fit.caption, "impact");
  assert.ok(fit.kenBurns.punchIn);
  const fast = planStyle({ niche: "fitness", timing: timing(3, 30, 210), imageStats: [null, null, null] });
  assert.ok(fast.transitionFrames <= fit.transitionFrames, "faster speech → snappier transitions");
  console.log("ok  niche presets differ; pace adjusts", fit.transitionFrames, "→", fast.transitionFrames, "frames");
}

{
  const plan = planStyle({
    niche: "general",
    caption: "playful",
    timing: timing(2),
    imageStats: [
      { luma: 0.15, saturation: 0.1, warmth: 0, aspect: 0.66 }, // dark, dull, portrait
      { luma: 0.8, saturation: 0.7, warmth: 0.2, aspect: 1.5 }, // bright, vivid, landscape
    ],
  });
  assert.equal(plan.caption, "playful", "caption override wins");
  assert.equal(plan.scenes[0].fit, "blur-fill");
  assert.equal(plan.scenes[1].fit, "cover");
  const bright = (f: string) => Number(/brightness\(([\d.]+)\)/.exec(f)![1]);
  assert.ok(bright(plan.scenes[0].filter) > bright(plan.scenes[1].filter), "dark photo is lifted more");
  const props = buildVideoProps(timing(2), plan, "a.mp3", [
    { src: "1.jpg", kind: "image", duration: null },
    { src: "2.mp4", kind: "video", duration: 8.5 },
  ]);
  assert.equal(props.scenes[0].src, "1.jpg");
  assert.equal(props.scenes[0].fit, "blur-fill");
  assert.equal(props.scenes[1].kind, "video");
  assert.equal(props.scenes[1].duration, 8.5);
  console.log("ok  per-image grade + portrait fit:", plan.scenes.map((s) => s.filter).join(" | "));
}

// 3. Media kinds.
{
  assert.equal(mediaKindOf("clip.MOV"), "video");
  assert.equal(mediaKindOf("https://x.public.blob.vercel-storage.com/uploads/video-a-8Hq.mp4"), "video");
  assert.equal(mediaKindOf("photo.jpeg"), "image");
  assert.equal(mediaKindOf("blob", "video/webm"), "video");
  assert.equal(mediaKindOf("notes.txt"), null);
  console.log("ok  image/video detection");
}

// 4. Whole-video effects replace the niche's grade and finishing layers.
{
  const stats = [{ luma: 0.46, saturation: 0.3, warmth: 0, aspect: 1.78 }];
  const t = timing(1);
  const plain = planStyle({ niche: "documentary", timing: t, imageStats: stats });
  const vhs = planStyle({ niche: "documentary", timing: t, imageStats: stats, effect: "vhs" });
  assert.equal(plain.effect, "none");
  assert.equal(vhs.effect, "vhs");
  assert.ok(plain.effects.letterbox && !vhs.effects.letterbox, "niche finish is switched off under an effect");
  assert.ok(/sepia/.test(plain.scenes[0].filter) && !/sepia/.test(vhs.scenes[0].filter), "niche grade gives way");
  assert.deepEqual(vhs.transitions, plain.transitions, "transitions still follow the niche");
  assert.ok(encoderCrf(vhs) > encoderCrf({ ...vhs, effect: "cinematic" }), "grainier look → higher CRF");
  for (const id of VIDEO_EFFECTS) planStyle({ niche: "general", timing: t, imageStats: stats, effect: id });
  console.log("ok  video effects:", VIDEO_EFFECTS.join(", "));
}

console.log("all style checks passed");
