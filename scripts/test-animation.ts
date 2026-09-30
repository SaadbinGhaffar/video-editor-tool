// Checks for the animated segments: `npm run test:animation`
import assert from "node:assert/strict";
import {
  animationTheme,
  basicAnimation,
  cleanAnimationPlan,
  cleanBeatContent,
  findRatio,
  findStat,
  findStreak,
  headline,
  kineticCards,
  numbersGrounded,
  parseDataCharts,
  planImageScenes,
  planSegments,
  sentencesIn,
  syncItems,
  timeBeats,
  timelineShots,
} from "../lib/animation";
import { buildVideoProps, planStyle } from "../lib/style";
import type { TimedWord, Timing } from "../lib/types";

/** Narration of `count` eight-word sentences, 0.4 s a word with a short pause after each sentence. */
function narration(count: number, sentence = (i: number) => `Sentence number ${i} of the long story here.`): TimedWord[] {
  const words: TimedWord[] = [];
  let t = 0.3;
  for (let i = 0; i < count; i++) {
    for (const text of sentence(i).split(" ")) {
      words.push({ text, start: t, end: t + 0.35 });
      t += 0.4;
    }
    t += 0.3;
  }
  return words;
}

// 1. A 5-minute video is 40% animated, in ~40 s chunks spread through it, starting and ending on photos.
{
  const words = narration(86); // 86 × 3.5 s ≈ 301 s
  const duration = 302;
  const segs = planSegments(words, duration);
  assert.deepEqual(segs.map((s) => s.kind), ["images", "animated", "images", "animated", "images", "animated", "images"]);
  assert.equal(segs[0].start, 0);
  assert.equal(segs[segs.length - 1].end, duration);
  for (let i = 1; i < segs.length; i++) assert.equal(segs[i].start, segs[i - 1].end, "segments are contiguous");
  const animated = segs.filter((s) => s.kind === "animated");
  const total = animated.reduce((n, s) => n + s.end - s.start, 0);
  assert.ok(Math.abs(total - 120) < 12, `about 2 of the 5 minutes are animated (${total.toFixed(0)} s)`);
  for (const s of animated) assert.ok(Math.abs(s.end - s.start - 40) < 10, `chunk of ${(s.end - s.start).toFixed(1)} s`);
  for (const s of segs.filter((x) => x.kind === "images")) assert.ok(s.end - s.start > 30, "photo stretches between the chunks");
  assert.ok(animated[0].start > 30 && animated[animated.length - 1].end < duration - 30, "spread through the video, not bunched at an end");
  const ends = new Set(words.filter((w) => w.text.endsWith(".")).map((w) => w.end));
  for (const s of segs.slice(1)) {
    const before = words.filter((w) => w.end <= s.start).at(-1)!;
    assert.ok(ends.has(before.end), "cuts land on sentence breaks");
  }
  const more = planSegments(words, duration, 0.6).filter((s) => s.kind === "animated");
  assert.ok(more.reduce((n, s) => n + s.end - s.start, 0) > 170, "a bigger share means more animation");
  assert.deepEqual(planSegments(narration(26), 92).map((s) => s.kind), ["images", "animated", "images"], "90 s → one animated chunk");
  assert.equal(planSegments(narration(170), 600).filter((s) => s.kind === "animated").length, 6, "10 minutes → six chunks");
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;
  console.log("ok  5 min timeline:", segs.map((s) => `${s.kind === "animated" ? "ANIM" : "photos"} ${fmt(s.start)}–${fmt(s.end)}`).join(", "));
}

// 2. Images are spread over the photo chunks; with fewer images than chunks they're reused.
{
  const words = narration(86);
  const photo = planSegments(words, 302).filter((s) => s.kind === "images");
  const few = planImageScenes(words, photo, 2, 1.2);
  assert.ok("scenes" in few);
  assert.deepEqual(few.scenes.map((s) => s.image), [0, 1, 0, 1], "two photos take turns over four photo stretches");
  const many = planImageScenes(words, photo, 8, 1.2);
  assert.ok("scenes" in many);
  const scenes = many.scenes;
  assert.deepEqual(scenes.map((s) => s.image), [0, 1, 2, 3, 4, 5, 6, 7], "each image once, in upload order");
  for (const seg of photo) {
    const inSeg = scenes.filter((s) => s.start >= seg.start && s.end <= seg.end);
    assert.ok(inSeg.length >= 2, "every photo chunk gets a share of the images");
    assert.equal(inSeg[0].start, seg.start);
    assert.equal(inSeg[inSeg.length - 1].end, seg.end);
  }
  const tooMany = planImageScenes(narration(3), [{ start: 0, end: 3 }], 5, 1.2);
  assert.deepEqual(tooMany, { maxImages: 2 });
  console.log("ok  image allocation:", scenes.map((s) => `${s.image}@${s.start.toFixed(0)}`).join(" "));
}

// 3. List items appear when the narration says them.
{
  const words = narration(1, () => "First we cut costs, then batteries got cheaper, and charging is everywhere.");
  const items = syncItems(["Lower costs", "Cheaper batteries", "Charging everywhere"], words, 0, 10);
  const at = (w: string) => words.find((x) => x.text.startsWith(w))!.start;
  assert.equal(items[0].at, at("costs"));
  assert.equal(items[1].at, at("batteries"));
  assert.equal(items[2].at, at("charging"));
  const unmatched = syncItems(["Alpha", "Beta", "Gamma"], words, 0, 10);
  assert.ok(unmatched.every((it, i) => i === 0 || it.at > unmatched[i - 1].at), "unmatched items are spread in order");
  assert.ok(unmatched.every((it) => it.at >= 0.6 && it.at <= 9.5), "and all appear inside the beat");
  console.log("ok  item sync:", items.map((i) => i.at.toFixed(1)).join(", "));
}

// 4. Beat content from an untrusted model reply is cleaned or rejected.
{
  assert.equal(cleanBeatContent({ type: "nonsense" }), null);
  assert.equal(cleanBeatContent({ type: "bars", bars: [{ label: "A", value: 3 }] }), null, "a chart needs two bars");
  assert.equal(cleanBeatContent({ type: "stat", value: "lots", label: "x" }), null);
  const stat = cleanBeatContent({ type: "stat", value: "1,200", suffix: "+", label: "happy customers 🚀" });
  assert.deepEqual(stat, { kind: "stat", value: 1200, decimals: 0, prefix: "", suffix: "+", label: "happy customers" });
  assert.deepEqual(cleanBeatContent({ type: "words", emphasis: ["Discipline,", "NOBODY", 3, "discipline"] }), {
    kind: "words",
    emphasis: ["discipline", "nobody", "3"],
  });
  assert.deepEqual(cleanBeatContent({ type: "words" }), { kind: "words", emphasis: [] }, "emphasis is optional");
  assert.deepEqual(cleanBeatContent({ type: "streak", marked: 47, label: "days straight" }), { kind: "streak", marked: 47, total: 56, label: "days straight" });
  assert.equal(cleanBeatContent({ type: "streak", marked: 500, label: "x" }), null, "a calendar holds at most 100 days");
  assert.deepEqual(cleanBeatContent({ type: "pictogram", filled: 7, total: 10, label: "owners" }), { kind: "pictogram", filled: 7, total: 10, label: "owners" });
  assert.equal(cleanBeatContent({ type: "pictogram", filled: 12, total: 10, label: "x" }), null, "can't fill more than the total");
  assert.equal(cleanBeatContent({ type: "line", points: [{ label: "a", value: 1 }, { label: "b", value: 2 }] }), null, "a line needs 3 points");
  const bullets = cleanBeatContent({ type: "bullets", title: "**Why**", items: ["a".repeat(200), "b", "", "c", "d", "e"] });
  assert.ok(bullets && bullets.kind === "bullets");
  assert.equal(bullets.title, "Why", "markdown stripped");
  assert.equal(bullets.items.length, 4, "at most four bullets, empty ones dropped");
  assert.ok(bullets.items[0].text.length <= 56, "long text clipped");

  const source = "Sales grew from 3 million in 2020 to 14.5 million, about 1,200 a day.";
  const statOf = (value: number) => ({ kind: "stat" as const, value, decimals: 0, prefix: "", suffix: "", label: "x" });
  assert.ok(numbersGrounded(statOf(14.5), source));
  assert.ok(numbersGrounded(statOf(1200), source));
  assert.ok(!numbersGrounded(statOf(4), source), "4 isn't in 14.5");
  assert.ok(!numbersGrounded({ kind: "bars", title: null, unit: "", bars: [{ label: "a", value: 3 }, { label: "b", value: 99 }] }, source));
  assert.ok(!numbersGrounded({ kind: "line", title: null, unit: "", points: [{ label: "a", value: 3 }, { label: "b", value: 14.5 }, { label: "c", value: 20 }] }, source));
  assert.ok(numbersGrounded({ kind: "pictogram", filled: 3, total: 100, label: "x" }, source), "a percentage's 100 is implied");
  assert.ok(!numbersGrounded({ kind: "streak", marked: 47, total: 49, label: "x" }, source), "a streak's day count must be said");
  console.log("ok  beat cleaning + number grounding");
}

// 5. Beats are placed on the timeline at their sentences.
{
  const words = narration(12);
  const sentences = sentencesIn(words, 0, 42);
  assert.equal(sentences.length, 12);
  const title = { kind: "title" as const, title: "Hello", subtitle: null };
  const beats = timeBeats(
    [
      { sentence: 4, content: { kind: "words", emphasis: [] } },
      { sentence: 0, content: title },
      { sentence: 4, content: title }, // same moment as the words: too close, dropped
      { sentence: 7, content: { kind: "bullets", title: null, items: [{ text: "sentence", at: NaN }, { text: "story", at: NaN }] } },
      { sentence: 99, content: title }, // no such sentence
    ],
    sentences,
    { start: 0, end: 42 },
    words,
  );
  assert.deepEqual(beats.map((b) => b.kind), ["title", "words", "bullets"]);
  assert.equal(beats[0].start, 0);
  assert.ok(Math.abs(beats[1].start - (sentences[4].start - 0.15)) < 1e-9);
  assert.equal(beats[0].end, beats[1].start);
  assert.equal(beats[2].end, 42);
  const list = beats[2];
  assert.ok(list.kind === "bullets" && list.items.every((it) => it.at >= list.start && it.at < list.end));
  console.log("ok  beat timing:", beats.map((b) => `${b.kind}@${b.start.toFixed(1)}`).join(" "));
}

// 6. Offline design: numbers become counters, the user's data becomes a chart.
{
  const data = "EV sales (millions)\n2020: 3\n2022: 10\n2023: 14\n\nNot a chart line";
  const charts = parseDataCharts(data);
  assert.equal(charts.length, 1);
  assert.equal(charts[0].title, "EV sales (millions)");
  assert.deepEqual(charts[0].bars.map((b) => b.value), [3, 10, 14]);
  assert.deepEqual(parseDataCharts("Price: $1,200\nTax: $300"), [
    { title: null, unit: "$", bars: [{ label: "Price", value: 1200 }, { label: "Tax", value: 300 }] },
  ]);
  assert.deepEqual(findStat("Sales rose 73% last year."), { value: 73, decimals: 0, prefix: "", suffix: "%" });
  assert.deepEqual(findStat("It costs $4.5 million to build."), { value: 4.5, decimals: 1, prefix: "$", suffix: "M" });
  assert.equal(findStat("There are 3 reasons."), null, "a bare small count isn't a stat");
  assert.equal(findStat("Cities want this by 2030."), null, "nor is a year");
  assert.deepEqual(findRatio("Seven? No: 7 out of 10 owners agree."), { filled: 7, total: 10 });
  assert.deepEqual(findRatio("About 1 in 4 homes."), { filled: 1, total: 4 });
  assert.deepEqual(findRatio("Prices fell by 90 percent."), { filled: 90, total: 100 });
  assert.deepEqual(findStreak("Nobody claps for day 47."), { marked: 47, total: 56 });
  assert.deepEqual(findStreak("I trained 30 days straight."), { marked: 30, total: 35 });
  assert.equal(findStreak("Wait 2 days."), null, "too short to be a streak");

  const lines = [
    "Electric cars are taking over the roads.",
    "Here is what changed for drivers.",
    "Batteries are much cheaper now.",
    "Sales hit 14 million cars in 2023.",
    "Charging points are everywhere.",
    "Running costs are far lower too.",
    "Look at the sales from 2020 to 2023.",
    "Every year the number climbed higher.",
    "Nobody expected it to happen this fast.",
    "Experts now call it unstoppable.",
    "Some cities want only electric by 2030.",
    "That is the story so far.",
  ];
  const words = narration(lines.length, (i) => lines[i]);
  const plan = basicAnimation(words, [{ start: 0, end: words.at(-1)!.end + 0.5 }], data);
  const kinds = plan.segments[0].beats.map((b) => b.kind);
  assert.equal(plan.source, "basic");
  assert.equal(kinds[0], "words", "a chunk opens on the narration's own words");
  assert.ok(kinds.includes("line"), `year-by-year data becomes a line chart (${kinds})`);
  assert.ok(kinds.includes("stat"), `number became a counter (${kinds})`);
  for (let i = 1; i < kinds.length; i++) {
    assert.ok(kinds[i] === "words" || kinds[i - 1] === "words", `kinetic words between data moments (${kinds})`);
  }
  console.log("ok  offline design:", kinds.join(" → "));

  // 7. A plan survives the round trip through the browser, and tampering is rejected.
  const duration = 60;
  assert.deepEqual(cleanAnimationPlan(JSON.parse(JSON.stringify(plan)), duration), plan);
  const broken = JSON.parse(JSON.stringify(plan));
  broken.segments[0].beats[0].kind = "script";
  assert.equal(cleanAnimationPlan(broken, duration), null);
  assert.equal(cleanAnimationPlan({ segments: [{ start: 0, end: 500, beats: plan.segments[0].beats }] }, duration), null, "past the end");
  console.log("ok  plan validation");
}

// 8. Photos and animation become one series of shots with transitions between them all.
{
  const timing: Timing = {
    durationInSeconds: 30,
    audioOffset: 0,
    words: 4,
    wpm: 150,
    provider: "test",
    detected: { niche: "tech", confidence: 1, signals: [], source: "keywords" },
    cues: [{ start: 0, end: 1, words: [{ text: "hi", start: 0, end: 1 }] }],
    scenes: [
      { start: 0, end: 5, image: 0 },
      { start: 5, end: 10, image: 1 },
      { start: 20, end: 30, image: 0 },
    ],
    animation: {
      source: "basic",
      segments: [{ start: 10, end: 20, beats: [{ kind: "title", start: 10, end: 20, title: "Hi", subtitle: null }] }],
    },
  };
  assert.deepEqual(timelineShots(timing).map((s) => s.kind), ["image", "image", "animated", "image"]);
  const plan = planStyle({ niche: "tech", timing, imageStats: [null, { luma: 0.4, saturation: 0.3, warmth: 0, aspect: 0.6 }] });
  assert.equal(plan.transitions.length, 3, "one transition per cut, animation included");
  assert.equal(plan.scenes.length, 2, "one look per uploaded image");
  const props = buildVideoProps(timing, plan, "a.mp3", ["one.jpg", "two.jpg"]);
  assert.deepEqual(
    props.scenes.map((s) => (s.kind === "image" ? `${s.src}/${s.fit}` : "animated")),
    ["one.jpg/cover", "two.jpg/blur-fill", "animated", "one.jpg/cover"],
    "reused image keeps its own look",
  );
  const anim = props.scenes[2];
  assert.ok(anim.kind === "animated" && anim.images.map((i) => i.src).join() === "one.jpg,two.jpg", "animated chunks get the photos as backgrounds");
  console.log("ok  shots:", props.scenes.map((s) => s.kind).join(" "));
}

// 9a. Offline on-screen text is the sentence's key phrase, not its first words.
{
  assert.equal(headline("There is no oil to change, no gearbox to repair, and the brakes last much longer.", 6), "No oil to change");
  assert.equal(headline("Today there are charging points at supermarkets, offices and motorway stops.", 6), "Charging points at supermarkets");
  assert.equal(headline("Over the last ten years, battery prices fell by almost 90 percent.", 9, true), "Battery prices fell by almost 90 percent");
  assert.equal(headline("Most owners simply charge at home overnight, and wake up to a full battery.", 7), "Most owners simply charge at home overnight");
  console.log("ok  key phrases");
}

// 9. Kinetic typography: phrases of the narration, each with a word to emphasise.
{
  const said = "Nobody claps for day 47. Nobody posts the 5 a.m. runs, the quiet reps, the sessions where you almost quit.";
  const words = narration(1, () => said);
  const cards = kineticCards(words, 0, 20, 4);
  assert.deepEqual(
    cards.map((c) => c.words.map((w) => w.text).join(" ")),
    ["Nobody claps for day", "47.", "Nobody posts the 5", "a.m. runs,", "the quiet reps,", "the sessions where you", "almost quit."],
  );
  assert.equal(cards[1].layout, "hero", "a lone word gets the whole screen");
  assert.equal(cards[1].words[cards[1].key].text, "47.");
  assert.equal(cards[0].words[cards[0].key].text, "Nobody", "longest meaningful word");
  assert.equal(cards[2].words[cards[2].key].text, "5", "numbers stand out");
  for (let i = 1; i < cards.length; i++) assert.equal(cards[i].start, cards[i - 1].end, "one phrase follows the next");
  assert.equal(cards[0].start, 0);
  assert.equal(cards.at(-1)!.end, 20);
  const filler = kineticCards(narration(1, () => "There is no oil."), 0, 5, 4);
  assert.equal(filler[0].words[filler[0].key].text, "oil.", "filler like 'there' never takes the spotlight");
  const picked = kineticCards(words, 0, 20, 4, ["claps"]);
  assert.equal(picked[0].words[picked[0].key].text, "claps", "the AI's emphasis wins");
  console.log("ok  kinetic cards:", cards.map((c) => `${c.layout}:${c.words[c.key].text}`).join(" "));
}

// 10. Accent colours stay readable on the dark animated backgrounds.
{
  assert.equal(animationTheme("fitness", "impact").accent, "#FF3B30", "bright red kept");
  assert.notEqual(animationTheme("business", "clean").accent, "#2563EB", "deep blue lightened");
  assert.equal(animationTheme("business", "clean").heading, "inter");
  console.log("ok  themes");
}

console.log("all animation checks passed");
