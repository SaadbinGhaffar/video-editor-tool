import "server-only";
import {
  basicAnimation,
  cleanBeatContent,
  numbersGrounded,
  sentencesIn,
  timeBeats,
  type BeatDraft,
  type Sentence,
} from "./animation";
import { aiProvider, type AiProvider } from "./llm";
import { NICHE_LABELS } from "./niche";
import type { AnimatedSegment, AnimationPlan, NicheId, TimedWord } from "./types";

const SYSTEM_PROMPT = `You are the motion designer of a cinematic YouTube video (the look of top motivational, documentary and explainer channels). You get one chunk (about 40 seconds) of the narration, split into numbered sentences with their start times, and optional reference data from the creator. Plan the motion graphics for that chunk. They play over the creator's own photos, darkened and moving, with particles and light effects.

Reply with JSON only: {"beats": [ ... ]}. One beat per 5–9 seconds of narration (4–7 for a 40-second chunk), in order. Every beat has "sentence": the index of the sentence where it appears (the first beat uses 0; strictly increasing), and one of these shapes:
- {"type":"words","emphasis":["word", ...]}: kinetic typography. The narration's own words slam onto the screen as they're spoken, a few at a time. List 2–6 of the most powerful words said in this beat (copied exactly from the sentences) to show big and in colour. Use this for most beats, especially emotional or dramatic lines.
- {"type":"stat","value":73,"prefix":"a currency symbol or empty","suffix":"%, x, K, M, B, + or a short unit, or empty","label":"max 7 words"}: a giant counter for one striking number.
- {"type":"streak","marked":47,"label":"max 7 words"}: a calendar with that many days crossed off, for streaks, "day 47", "30 days in a row".
- {"type":"pictogram","filled":7,"total":10,"label":"max 7 words"}: "7 in 10 people"; total is 2–20, or 100 for a percentage.
- {"type":"bars","title":"max 5 words","unit":"%, $, a short unit, or empty","bars":[{"label":"max 3 words","value":12.5}, ...]}: 2–6 quantities to compare.
- {"type":"line","title":"max 5 words","unit":"...","points":[{"label":"2020","value":3}, ...]}: 3–8 values over time.
- {"type":"compare","left":{"title":"max 2 words","points":["max 4 words", ...]},"right":{...}}: a split screen of two options, 1–3 points each.
- {"type":"bullets","title":"max 4 words or empty","items":["max 5 words", ...]}: 2–4 numbered points, in the order they're said.
- {"type":"steps","title":"max 4 words or empty","items":["max 4 words", ...]}: 3–5 stages of a process or timeline.
- {"type":"title","title":"max 5 words","subtitle":"max 6 words or empty"}: a chapter card, only when the narration clearly starts a new part.

Rules:
- Show only what the narration says or the reference data contains. Never invent or estimate numbers: every value must appear in the narration or the reference data. When the narration talks about something the reference data has figures for, chart those exact figures.
- Each beat must match what is being said from its sentence on. Never put two non-"words" beats back to back: kinetic words come between data moments.
- On-screen text is a few punchy words, in the same language as the narration. No emojis, no markdown.`;

/**
 * Design the animated segments. With an AI key, a model designs each segment
 * from its narration and the user's data; a segment falls back to the offline
 * design if the model fails or its reply is unusable, so this never errors.
 */
export async function planAnimation({
  words,
  segments,
  transcript,
  data,
  niche,
}: {
  words: TimedWord[];
  segments: { start: number; end: number }[];
  transcript: string;
  data: string;
  niche: NicheId;
}): Promise<AnimationPlan> {
  const basic = basicAnimation(words, segments, data);
  const provider = aiProvider();
  if (!provider) return basic;

  const designed = await Promise.all(
    segments.map((seg, k) =>
      designSegment(provider, { seg, index: k, count: segments.length, words, transcript, data, niche }).catch((err) => {
        console.warn(`[animation] segment ${k + 1} failed, using the basic design:`, err instanceof Error ? err.message : err);
        return null;
      }),
    ),
  );
  return {
    segments: segments.map((_, k) => designed[k] ?? basic.segments[k]),
    source: designed.some(Boolean) ? "llm" : "basic",
  };
}

async function designSegment(
  provider: AiProvider,
  job: {
    seg: { start: number; end: number };
    index: number;
    count: number;
    words: TimedWord[];
    transcript: string;
    data: string;
    niche: NicheId;
  },
): Promise<AnimatedSegment | null> {
  const { seg, words, data } = job;
  const sentences = sentencesIn(words, seg.start, seg.end);
  if (!sentences.length) return null;
  const model = provider.animationModel;
  const client = provider.client({ timeout: 60_000, maxRetries: 1 });
  const res = await client.chat.completions.create({
    model,
    // Reasoning models (gpt-oss) spend output tokens thinking first; keep that short.
    ...(/gpt-oss|^o\d/.test(model) ? { reasoning_effort: "low" as const } : {}),
    max_completion_tokens: 2500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(job, sentences) },
    ],
  });
  const reply = JSON.parse(res.choices[0]?.message?.content ?? "null") as { beats?: unknown } | null;
  if (!reply || !Array.isArray(reply.beats)) return null;

  const source = `${sentences.map((s) => s.text).join(" ")}\n${data}`;
  const drafts: BeatDraft[] = [];
  for (const raw of reply.beats) {
    const content = cleanBeatContent(raw);
    const sentence = Number((raw as { sentence?: unknown })?.sentence);
    // Drop any chart or counter whose numbers the model made up.
    if (content && numbersGrounded(content, source)) drafts.push({ sentence, content });
  }
  const beats = timeBeats(drafts, sentences, seg, words);
  return beats.length ? { start: seg.start, end: seg.end, beats } : null;
}

function userPrompt(
  job: { seg: { start: number; end: number }; index: number; count: number; transcript: string; data: string; niche: NicheId },
  sentences: Sentence[],
): string {
  const length = Math.round(job.seg.end - job.seg.start);
  const lines = sentences.map((s, i) => `[${i}] (${(s.start - job.seg.start).toFixed(1)} s) ${s.text}`).join("\n");
  const data = job.data.trim();
  return [
    `Video niche: ${NICHE_LABELS[job.niche]}. This is animated chunk ${job.index + 1} of ${job.count}, ${length} s long, between photo sections.`,
    `What the whole video is about (opening of the narration): ${job.transcript.slice(0, 500)}`,
    `Sentences of this chunk:\n${lines}`,
    data ? `Reference data from the creator:\n${data.slice(0, 6000)}` : "No reference data was given.",
  ].join("\n\n");
}
