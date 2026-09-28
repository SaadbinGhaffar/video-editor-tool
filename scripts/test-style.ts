// Checks for niche detection and the style planner: `npm run test:style`
import assert from "node:assert/strict";
import { detectNicheFromText } from "../lib/niche";
import { estimateRenderMinutes } from "../lib/renderBudget";
import { basicSeo, cleanSeo, TITLE_MAX } from "../lib/seoText";
import { buildVideoProps, encoderCrf, needsBlurFill, planStyle } from "../lib/style";
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
  const props = buildVideoProps(timing(2), plan, "a.mp3", ["1.jpg", "2.jpg"]);
  assert.equal(props.scenes[0].src, "1.jpg");
  assert.equal(props.scenes[0].fit, "blur-fill");
  console.log("ok  per-image grade + portrait fit:", plan.scenes.map((s) => s.filter).join(" | "));
}

// 3. Whole-video effects replace the niche's grade and finishing layers.
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

// 4. Render time estimate.
{
  const hobby = { vcpus: 4, maxMinutes: 45 };
  assert.ok(estimateRenderMinutes(60, { ...hobby, vcpus: 8 }) < estimateRenderMinutes(60, hobby), "more vCPUs render faster");
  assert.ok(estimateRenderMinutes(300, hobby) > estimateRenderMinutes(60, hobby), "longer videos take longer");
  console.log("ok  render estimate: 5 min video ≈", Math.round(estimateRenderMinutes(300, hobby)), "min on 4 vCPUs");
}

// 5. YouTube title/description helpers.
{
  const clean = cleanSeo({
    title: "“Automatic Video Editor Test: Captions, Pan‑and‑Zoom Demo”",
    description: "Discover how the automatic video editor adds captions.\n\n\n\nLike and subscribe for more.\n\n#old #hashtags",
    hashtags: ["#videoeditor", "auto captions", "videoeditor"],
    tags: ["Video Editor", "video editor", "captions"],
  })!;
  assert.equal(clean.title, 'Automatic Video Editor Test: Captions, Pan-and-Zoom Demo"'.replace(/"$/, ""));
  assert.ok(
    clean.description.endsWith("Like and subscribe for more.\n\nTags: video editor, captions\n\n#videoeditor #autocaptions"),
    "description ends with the tags, then the deduplicated hashtags (the model's own hashtag line replaced)",
  );
  assert.ok(!clean.description.includes("\n\n\n"), "blank-line runs collapsed");
  assert.deepEqual(clean.tags, ["video editor", "captions"]);
  assert.equal(cleanSeo({ title: "x" }), null, "unusable reply is rejected");
  assert.ok(cleanSeo({ title: "a".repeat(150), description: "b ".repeat(40) })!.title.length <= TITLE_MAX);

  const basic = basicSeo(
    "Hi, I'm John Smith, and um, today we are testing the automatic video editor. It listens to the narration and puts captions on screen. The editor animates each photo.",
    "tech",
  );
  assert.equal(basic.source, "basic");
  assert.ok(basic.title.startsWith("Hi, I'm John Smith, and today we are testing") && basic.title.length <= 70);
  assert.ok(basic.tags.includes("editor") && basic.description.includes("\n\nTags: ") && basic.description.includes("#tech"));
  console.log("ok  seo helpers:", basic.title);
}

// 6. YouTube Shorts (9:16).
{
  const landscapePhoto = { luma: 0.46, saturation: 0.3, warmth: 0, aspect: 1.5 };
  const portraitPhoto = { ...landscapePhoto, aspect: 0.66 };
  const t = timing(2);
  const wide = planStyle({ niche: "documentary", timing: t, imageStats: [landscapePhoto, portraitPhoto] });
  const short = planStyle({ niche: "documentary", timing: t, imageStats: [landscapePhoto, portraitPhoto], format: "shorts" });
  assert.equal(wide.format, "landscape");
  assert.deepEqual(wide.scenes.map((s) => s.fit), ["cover", "blur-fill"]);
  assert.deepEqual(short.scenes.map((s) => s.fit), ["blur-fill", "cover"], "in a Short, landscape photos are fitted");
  assert.ok(wide.effects.letterbox && !short.effects.letterbox, "no letterbox bars on vertical video");
  assert.ok(needsBlurFill(0.75, "landscape") && !needsBlurFill(0.75, "shorts"));

  const words = "one two three four five six seven eight".split(" ").map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const cues = [{ start: 0, end: 2.4, words }];
  const tt: Timing = { ...timing(2, 2.4), cues };
  const shortProps = buildVideoProps(tt, planStyle({ niche: "general", timing: tt, imageStats: [null, null], format: "shorts" }), "a.mp3", ["1.jpg", "2.jpg"]);
  assert.ok(shortProps.cues.every((c) => c.words.length <= 3), "Shorts captions show at most 3 words");
  assert.equal(shortProps.cues.flatMap((c) => c.words).length, words.length, "no words lost when regrouping");
  assert.equal(shortProps.style.format, "shorts");

  const seo = cleanSeo({ title: "A short title for a Short", description: "d ".repeat(30), hashtags: ["tech", "Shorts"], tags: [] }, true)!;
  assert.ok(seo.description.endsWith("#shorts #tech"), "Shorts lead with #shorts, once");
  assert.ok(basicSeo("This is a quick tip about coding faster. Use shortcuts every day.", "tech", true).description.includes("#shorts"));
  console.log("ok  shorts: fit", short.scenes.map((s) => s.fit).join("/"), "· cues", shortProps.cues.map((c) => c.words.length).join(","));
}

console.log("all style checks passed");
