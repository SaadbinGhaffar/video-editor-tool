// Quick sanity checks for the transcript alignment: `npm run test:align`
import assert from "node:assert/strict";
import { alignTranscript, groupIntoCues, planSceneBoundaries } from "../lib/align";
import type { TimedWord } from "../lib/types";

const rec = (s: string, start = 0, step = 0.4): TimedWord[] =>
  s.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + step * 0.8 }));

// 1. Misheard name + dropped filler: user wording wins, timing inherited.
{
  const recognized = rec("hi I'm sad um and this is my channel");
  const out = alignTranscript("Hi, I'm Saad, and this is my channel.", recognized, 5);
  assert.deepEqual(
    out.map((w) => w.text),
    ["Hi,", "I'm", "Saad,", "and", "this", "is", "my", "channel."],
  );
  // "Saad," aligns to "sad"; "and" must keep the recognizer's timing for "and" (index 4), not "um".
  assert.equal(out[2].start, recognized[2].start);
  assert.equal(out[3].start, recognized[4].start);
  assert.equal(out[7].end, recognized[8].end);
  console.log("ok  misheard name + dropped filler");
}

// 2. A user word the recognizer missed entirely gets an interpolated time between neighbours.
{
  const recognized = rec("the quick fox jumps");
  const out = alignTranscript("The quick brown fox jumps.", recognized, 3);
  const brown = out[2];
  assert.equal(brown.text, "brown");
  assert.ok(brown.start >= out[1].end && brown.end <= out[3].start, "brown sits between quick and fox");
  console.log("ok  interpolated missing word");
}

// 3. Numbers spelled differently still land on the right span.
{
  const recognized = rec("I have 25 cats at home");
  const out = alignTranscript("I have twenty-five cats at home", recognized, 4);
  assert.equal(out[2].text, "twenty-five");
  assert.equal(out[2].start, recognized[2].start);
  assert.equal(out[2].end, recognized[2].end);
  console.log("ok  number substitution");
}

// 4. Empty recognition falls back to spreading over the file.
{
  const out = alignTranscript("one two three", [], 3);
  assert.equal(out.length, 3);
  assert.ok(out[2].end <= 3 && out[0].start === 0);
  console.log("ok  no recognized words");
}

// 5. Cues: max 4 words, break on sentence end.
{
  const words = alignTranscript(
    "This is a longer sentence that keeps going. Short one.",
    rec("this is a longer sentence that keeps going short one"),
    6,
  );
  const cues = groupIntoCues(words);
  assert.ok(cues.every((c) => c.words.length >= 1 && c.words.length <= 4));
  assert.ok(cues.some((c) => c.words[c.words.length - 1].text === "going."));
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end - 1e-9);
  console.log("ok  cue grouping:", cues.map((c) => c.words.map((w) => w.text).join(" ")).join(" | "));
}

// 5b. No dangling single word at the end of a phrase.
{
  const words = alignTranscript(
    "Then, a foggy forest road.",
    rec("then a foggy forest road"),
    3,
  );
  const cues = groupIntoCues(words).map((c) => c.words.map((w) => w.text).join(" "));
  assert.deepEqual(cues, ["Then, a foggy", "forest road."]);
  console.log("ok  no orphan word:", cues.join(" | "));
}

// 6. Scene cuts snap to a sentence break near the even split.
{
  const words: TimedWord[] = [
    ...rec("one two three four five six seven eight nine ten.", 0, 0.45),
    ...rec("eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen", 5.0, 0.55),
  ];
  const bounds = planSceneBoundaries(words, 10, 2, 1.2);
  assert.equal(bounds.length, 3);
  assert.ok(bounds[1] > 4.1 && bounds[1] < 5.0, `cut ${bounds[1]} should be in the sentence gap`);
  console.log("ok  scene boundary snapped to", bounds[1].toFixed(2));
}

console.log("all alignment checks passed");
