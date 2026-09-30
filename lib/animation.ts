import { normalizeWord, planSceneBoundaries } from "./align";
import { CAPTION_LOOKS, type FontKey } from "./captionLooks";
import type {
  AnimatedSegment,
  AnimationPlan,
  AnimBeat,
  AnimItem,
  CaptionStyleId,
  NicheId,
  TimedWord,
  Timing,
} from "./types";

// Animated segments: chunks of the video, spread through it, drawn as
// cinematic motion graphics over the user's own photos: kinetic typography of
// the narration, counters, streak calendars, charts, split screens…
// Pure and shared by the browser and the server; the AI part is in
// animation-llm.ts.

/** Target length of one animated chunk. */
export const ANIMATED_CHUNK_SECONDS = 40;
/** How much of the video is animated, as offered in the UI. */
export const ANIMATION_SHARES = [0.25, 0.4, 0.5, 0.6] as const;
/** 2 minutes of every 5. */
export const DEFAULT_ANIMATION_SHARE = 0.4;
/** Below this, there isn't room for photos and animation to take turns. */
export const MIN_ANIMATED_VIDEO_SECONDS = 20;
/** A beat shorter than this can't be read before the next one replaces it. */
export const MIN_BEAT_SECONDS = 3.5;
export const MAX_BEATS_PER_SEGMENT = 10;
/** Longest "data for the animations" text we accept. */
export const MAX_ANIMATION_DATA_CHARS = 8000;

export type Segment = { kind: "images" | "animated"; start: number; end: number };

export const clampShare = (share: number) =>
  Number.isFinite(share) ? Math.min(0.7, Math.max(0.15, share)) : DEFAULT_ANIMATION_SHARE;

/**
 * Split the timeline so `share` of it is animated, in chunks of about 40 s
 * spread evenly through the whole video with photos between them, starting
 * and ending on photos. Each cut is snapped to a nearby sentence break.
 * A 5-minute video at 40%: photos 0:00–0:45, animation 0:45–1:25, photos,
 * animation 2:10–2:50, photos, animation 3:35–4:15, photos to the end.
 */
export function planSegments(words: TimedWord[], duration: number, share: number = DEFAULT_ANIMATION_SHARE): Segment[] {
  const animated = duration * clampShare(share);
  const chunks = Math.max(1, Math.round(animated / ANIMATED_CHUNK_SECONDS));
  const chunk = animated / chunks;
  const gap = (duration - animated) / (chunks + 1);
  const targets: number[] = [];
  for (let j = 0; j < chunks; j++) {
    const start = gap * (j + 1) + chunk * j;
    targets.push(start, start + chunk);
  }
  const snapped = snapToBreaks(words, targets, Math.min(gap, chunk) * 0.3, Math.min(4, gap / 2, chunk / 2));
  const bounds = [0, ...snapped, duration];
  return bounds.slice(0, -1).map((start, k) => ({ kind: k % 2 ? "animated" : "images", start, end: bounds[k + 1] }));
}

/** Move each time to the best phrase break within `reach`, keeping them in order at least `minGap` apart. */
function snapToBreaks(words: TimedWord[], targets: number[], reach: number, minGap: number): number[] {
  const candidates: { time: number; score: number }[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i];
    const b = words[i + 1];
    const pause = Math.max(0, b.start - a.end);
    const sentence = SENTENCE_END.test(a.text) ? 2 : /[,;:—–]["')\]”’]*$/.test(a.text) ? 0.7 : 0;
    candidates.push({ time: (a.end + b.start) / 2, score: sentence + Math.min(pause, 1.5) * 2 });
  }
  const out: number[] = [];
  targets.forEach((target, i) => {
    const lo = (i === 0 ? 0 : out[i - 1]) + minGap;
    const hi = (i + 1 < targets.length ? targets[i + 1] : Infinity) - minGap;
    let best = Math.min(Math.max(target, lo), hi);
    let bestScore = 0.3;
    for (const c of candidates) {
      if (Math.abs(c.time - target) > reach || c.time < lo || c.time > hi) continue;
      const score = c.score - Math.abs(c.time - target) / Math.max(reach, 1e-6);
      if (score > bestScore) {
        bestScore = score;
        best = c.time;
      }
    }
    out.push(best);
  });
  return out;
}

const SENTENCE_END = /[.!?…]["')\]”’]*$/;

/**
 * Spread the uploaded images over the photo chunks (in upload order,
 * proportionally to each chunk's length) and cut each chunk into scenes at
 * phrase breaks. With fewer images than chunks, images are reused in turn.
 * Returns how many images fit instead if there are too many.
 */
export function planImageScenes(
  words: TimedWord[],
  segments: { start: number; end: number }[],
  imageCount: number,
  minSceneSeconds: number,
): { scenes: { start: number; end: number; image: number }[] } | { maxImages: number } {
  const lengths = segments.map((s) => s.end - s.start);
  const fits = lengths.map((l) => Math.max(1, Math.floor(l / minSceneSeconds)));
  const maxImages = fits.reduce((a, b) => a + b, 0);
  if (imageCount > maxImages) return { maxImages };

  const counts = segments.map(() => 1);
  if (imageCount > segments.length) {
    const total = lengths.reduce((a, b) => a + b, 0);
    const exact = lengths.map((l) => (imageCount * l) / total);
    for (let k = 0; k < counts.length; k++) counts[k] = Math.min(fits[k], Math.max(1, Math.floor(exact[k])));
    const sum = () => counts.reduce((a, b) => a + b, 0);
    while (sum() < imageCount) {
      let best = -1;
      for (let k = 0; k < counts.length; k++) {
        if (counts[k] < fits[k] && (best < 0 || exact[k] - counts[k] > exact[best] - counts[best])) best = k;
      }
      counts[best]++;
    }
    while (sum() > imageCount) {
      let best = -1;
      for (let k = 0; k < counts.length; k++) {
        if (counts[k] > 1 && (best < 0 || exact[k] - counts[k] < exact[best] - counts[best])) best = k;
      }
      counts[best]--;
    }
  }

  const scenes: { start: number; end: number; image: number }[] = [];
  let next = 0;
  segments.forEach((seg, k) => {
    const local = wordsIn(words, seg.start, seg.end).map((w) => ({
      text: w.text,
      start: w.start - seg.start,
      end: Math.min(w.end, seg.end) - seg.start,
    }));
    const bounds = planSceneBoundaries(local, lengths[k], counts[k], minSceneSeconds);
    for (let i = 0; i < counts[k]; i++) {
      scenes.push({
        start: i === 0 ? seg.start : seg.start + bounds[i],
        end: i === counts[k] - 1 ? seg.end : seg.start + bounds[i + 1],
        image: next++ % imageCount,
      });
    }
  });
  return { scenes };
}

const wordsIn = (words: TimedWord[], start: number, end: number) => words.filter((w) => w.start >= start && w.start < end);

export type Sentence = { text: string; start: number; end: number };

/** The narration between two times, as sentences (long run-ons are split every 30 words). */
export function sentencesIn(words: TimedWord[], start: number, end: number): Sentence[] {
  const out: Sentence[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (cur.length) out.push({ text: cur.map((w) => w.text).join(" "), start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  for (const w of wordsIn(words, start, end)) {
    cur.push(w);
    if (SENTENCE_END.test(w.text) || cur.length >= 30) flush();
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Beat content: validation and timing
// ---------------------------------------------------------------------------

/** A beat without its times, as the designer (AI or offline) produces it. */
export type BeatContent = AnimBeat extends infer B ? (B extends { start: number } ? Omit<B, "start" | "end"> : never) : never;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Cut at a word boundary so it fits `max` characters. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.5 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}

/** On-screen text: one line, no markdown or emoji, at most `max` characters. */
function text(v: unknown, max: number): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  const s = String(v)
    .replace(/\p{Extended_Pictographic}|️/gu, "")
    .replace(/[*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clip(s, max);
}

const optText = (v: unknown, max: number) => text(v, max) || null;

function textList(v: unknown, max: number, lo: number, hi: number): string[] | null {
  if (!Array.isArray(v)) return null;
  const list = v.map((x) => text(isObj(x) ? x.text : x, max)).filter(Boolean).slice(0, hi);
  return list.length >= lo ? list : null;
}

/** Decimal places worth showing for a value (0–2). */
function decimalsOf(value: number): number {
  if (Number.isInteger(value)) return 0;
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9 ? 1 : 2;
}

/** Numbers can arrive as "1,200" or "73%" from a model; read them leniently. */
function number(v: unknown): number | null {
  if (num(v)) return v;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/[,\s$€£%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function points(v: unknown, lo: number, hi: number, labelMax: number): { label: string; value: number }[] | null {
  if (!Array.isArray(v)) return null;
  const list = v
    .map((b) => (isObj(b) ? { label: text(b.label, labelMax), value: number(b.value) } : null))
    .filter((b): b is { label: string; value: number } => !!b && !!b.label && b.value !== null && b.value >= 0 && b.value < 1e13)
    .slice(0, hi);
  return list.length >= lo && list.some((b) => b.value > 0) ? list : null;
}

/** Most words a kinetic-typography beat can highlight. */
const MAX_EMPHASIS = 16;

/**
 * Validate one beat's content from an untrusted source (the AI model's reply
 * or timing sent back by the browser). Text is trimmed to what fits on screen;
 * anything unusable gives null. Items keep a valid `at` if they have one.
 */
export function cleanBeatContent(raw: unknown): BeatContent | null {
  if (!isObj(raw)) return null;
  const kind = raw.kind ?? raw.type;
  const items = (lo: number, hi: number): AnimItem[] | null => {
    if (!Array.isArray(raw.items)) return null;
    const list = raw.items
      .map((x) => ({ text: text(isObj(x) ? x.text : x, 48), at: isObj(x) && num(x.at) ? x.at : NaN }))
      .filter((x) => x.text)
      .slice(0, hi);
    return list.length >= lo ? list : null;
  };
  switch (kind) {
    case "words": {
      const emphasis = Array.isArray(raw.emphasis)
        ? [...new Set(raw.emphasis.map((w) => normalizeWord(String(w ?? ""))).filter(Boolean))].slice(0, MAX_EMPHASIS)
        : [];
      return { kind, emphasis };
    }
    case "title": {
      const title = text(raw.title, 48);
      return title ? { kind, title, subtitle: optText(raw.subtitle, 60) } : null;
    }
    case "bullets":
    case "steps": {
      const list = items(2, kind === "bullets" ? 4 : 5);
      return list ? { kind, title: optText(raw.title, 50), items: list } : null;
    }
    case "stat": {
      const value = number(raw.value);
      const label = text(raw.label, 60);
      if (value === null || Math.abs(value) >= 1e13 || !label) return null;
      return { kind, value, decimals: decimalsOf(value), prefix: text(raw.prefix, 4), suffix: text(raw.suffix, 10), label };
    }
    case "streak": {
      const marked = number(raw.marked);
      const label = text(raw.label, 60);
      if (marked === null || !Number.isInteger(marked) || marked < 2 || marked > 100 || !label) return null;
      const total = number(raw.total);
      const days = total !== null && Number.isInteger(total) && total >= marked && total <= 100 ? total : streakTotal(marked);
      return { kind, marked, total: days, label };
    }
    case "pictogram": {
      const total = number(raw.total);
      const filled = number(raw.filled);
      const label = text(raw.label, 60);
      if (total === null || filled === null || !label || !Number.isInteger(total) || !Number.isInteger(filled)) return null;
      if (!((total >= 2 && total <= 20) || total === 100) || filled < 0 || filled > total) return null;
      return { kind, filled, total, label };
    }
    case "bars": {
      const bars = points(raw.bars, 2, 6, 24);
      return bars ? { kind, title: optText(raw.title, 50), unit: text(raw.unit, 8), bars } : null;
    }
    case "line": {
      const list = points(raw.points, 3, 8, 12);
      return list ? { kind, title: optText(raw.title, 50), unit: text(raw.unit, 8), points: list } : null;
    }
    case "compare": {
      const side = (v: unknown) => {
        if (!isObj(v)) return null;
        const title = text(v.title, 24);
        const pts = textList(v.points, 40, 1, 3);
        return title && pts ? { title, points: pts } : null;
      };
      const left = side(raw.left);
      const right = side(raw.right);
      return left && right ? { kind, left, right } : null;
    }
    default:
      return null;
  }
}

/** Calendar size for a streak: whole weeks, with at least a few days still to come. */
export const streakTotal = (marked: number) => Math.min(100, Math.ceil((marked + 3) / 7) * 7);

/** Every number a stat or chart shows must appear in the narration or the user's data. */
export function numbersGrounded(content: BeatContent, source: string): boolean {
  const values =
    content.kind === "stat"
      ? [content.value]
      : content.kind === "bars"
        ? content.bars.map((b) => b.value)
        : content.kind === "line"
          ? content.points.map((b) => b.value)
          : content.kind === "pictogram"
            ? content.total === 100
              ? [content.filled]
              : [content.filled, content.total]
            : content.kind === "streak"
              ? [content.marked]
              : [];
  if (!values.length) return true;
  const plain = source.replace(/(\d),(?=\d{3})/g, "$1");
  return values.every((v) => {
    const s = String(v).replace(/\.0+$/, "").replace(".", "\\.");
    return new RegExp(`(^|[^\\d.])${s}(?![\\d]|\\.\\d)`).test(plain);
  });
}

const STOPWORDS = new Set(
  (
    "the a an and or but of to in on at for with from by as is are was were be been it its this that these those " +
    "you your we our they their he she his her them i my me so if then than into over about more most very just " +
    "can will would should could do does did not no yes all any some one how what why when where which who"
  ).split(" "),
);

const keyTokens = (s: string) =>
  s
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w && !STOPWORDS.has(w) && (w.length >= 3 || /^\d/.test(w)));

const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

/**
 * When each list item appears: at the moment the narration first says one of
 * its key words (in order), otherwise spread evenly between the neighbours
 * that were found, so every item is on screen before the beat ends.
 */
export function syncItems(texts: string[], words: TimedWord[], start: number, end: number): { text: string; at: number }[] {
  const n = texts.length;
  const spoken = wordsIn(words, start, end).map((w) => ({ key: normalizeWord(w.text), at: w.start }));
  const lo = start + 0.6;
  const hi = Math.max(lo, end - 1.2);
  const found: (number | null)[] = [];
  let cursor = 0;
  for (const t of texts) {
    const keys = keyTokens(t);
    let at: number | null = null;
    for (let j = cursor; j < spoken.length && keys.length; j++) {
      if (keys.some((k) => sameWord(k, spoken[j].key))) {
        at = spoken[j].at;
        cursor = j + 1;
        break;
      }
    }
    found.push(at);
  }

  const step = Math.min(2.5, (hi - lo) / Math.max(1, n));
  const times = found.map((t, i) => {
    if (t !== null) return t;
    let a = i - 1;
    while (a >= 0 && found[a] === null) a--;
    let b = i + 1;
    while (b < n && found[b] === null) b++;
    if (a >= 0 && b < n) return found[a]! + ((found[b]! - found[a]!) * (i - a)) / (b - a);
    if (a >= 0) return found[a]! + step * (i - a);
    if (b < n) return found[b]! - step * (b - i);
    return lo + step * i;
  });
  const out: { text: string; at: number }[] = [];
  for (let i = 0; i < n; i++) {
    let at = Math.min(Math.max(times[i], lo), hi);
    if (i > 0) at = Math.max(at, out[i - 1].at + 0.35);
    out.push({ text: texts[i], at: Math.min(at, end - 0.5) });
  }
  return out;
}

function withTimes(content: BeatContent, start: number, end: number, words: TimedWord[]): AnimBeat {
  if (content.kind === "bullets" || content.kind === "steps") {
    const synced = syncItems(content.items.map((i) => i.text), words, start, end);
    return { ...content, start, end, items: content.items.map((it, i) => ({ ...it, at: synced[i].at })) };
  }
  return { ...content, start, end } as AnimBeat;
}

export type BeatDraft = { sentence: number; content: BeatContent };

/**
 * Place drafted beats on the timeline: each starts just before its sentence
 * is spoken (the first at the segment start) and runs until the next. Beats
 * too close to the previous one or to the segment's end are dropped.
 */
export function timeBeats(drafts: BeatDraft[], sentences: Sentence[], seg: { start: number; end: number }, words: TimedWord[]): AnimBeat[] {
  const valid = drafts
    .filter((d) => Number.isInteger(d.sentence) && d.sentence >= 0 && d.sentence < Math.max(1, sentences.length))
    .sort((a, b) => a.sentence - b.sentence);
  const placed: { start: number; content: BeatContent }[] = [];
  for (const d of valid) {
    if (placed.length >= MAX_BEATS_PER_SEGMENT) break;
    const start = placed.length === 0 ? seg.start : Math.max(seg.start, (sentences[d.sentence]?.start ?? seg.start) - 0.15);
    if (placed.length && (start < placed[placed.length - 1].start + MIN_BEAT_SECONDS || seg.end - start < MIN_BEAT_SECONDS)) {
      continue;
    }
    placed.push({ start, content: d.content });
  }
  return placed.map((b, i) => withTimes(b.content, b.start, i + 1 < placed.length ? placed[i + 1].start : seg.end, words));
}

// ---------------------------------------------------------------------------
// Offline designer (no AI key, or the model failed)
// ---------------------------------------------------------------------------

export type DataChart = { title: string | null; unit: string; bars: { label: string; value: number }[] };

const DATA_LINE = /^\s*(?:[-*•]\s*)?(.+?)\s*[:=|–—]\s*([$€£]?)\s*(-?\d[\d,]*(?:\.\d+)?)\s*(%|[A-Za-z]+)?\.?\s*$/;

/**
 * Charts in the user's data: runs of two or more "label: number" lines, e.g.
 *   EV sales (millions)
 *   2020: 3
 *   2023: 14
 * The line just above a run is used as its title.
 */
export function parseDataCharts(data: string): DataChart[] {
  const charts: DataChart[] = [];
  let title: string | null = null;
  let run: { label: string; value: number; unit: string }[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const units = run.map((r) => r.unit);
      const unit = units.sort((a, b) => units.filter((u) => u === b).length - units.filter((u) => u === a).length)[0];
      charts.push({ title, unit: text(unit, 8), bars: run.slice(0, 6).map((r) => ({ label: text(r.label, 28), value: r.value })) });
    }
    run = [];
  };
  for (const line of data.split(/\r?\n/)) {
    const m = DATA_LINE.exec(line);
    const value = m ? Number(m[3].replace(/,/g, "")) : NaN;
    if (m && Number.isFinite(value) && value >= 0) {
      run.push({ label: m[1], value, unit: m[2] || m[4] || "" });
    } else {
      flush();
      title = line.trim() ? text(line.replace(/:\s*$/, ""), 56) || null : title;
    }
  }
  flush();
  return charts;
}

const FILLERS = new Set(["so", "and", "but", "well", "now", "okay", "ok", "um", "uh", "like", "also", "then", "because"]);

/** Spoken lead-ins that carry no meaning on screen ("Today there are…", "Of course, …"). */
const LEAD_IN =
  /^(?:(?:so|and|but|now|then|today|first|firstly|second|next|finally|lastly|also|well|of course|in fact|actually|basically|here is|here's|there (?:is|are|was|were)|it is|it's|this is|that is|that's)\b[,:]?\s+)+/i;

/**
 * A short on-screen line from a spoken sentence: the clause that carries the
 * most meaning (or the number, with `preferNumber`), minus lead-ins and filler,
 * cut to `maxWords` at a content word.
 */
export function headline(sentence: string, maxWords: number, preferNumber = false): string {
  const clean = sentence.replace(/["“”]/g, "").trim();
  const clauses = clean
    .split(/[,;:—–]\s+|\s+(?:but|because|so)\s+/i)
    .map((c) => c.replace(/[.!?…]+$/, "").trim())
    .filter((c) => c.split(/\s+/).length >= 2);
  const score = (c: string) =>
    keyTokens(c).length + (preferNumber && /\d/.test(c) ? 5 : 0) - (LEAD_IN.test(c) ? 0.5 : 0);
  // The first clause wins ties: it's usually the point being made.
  let best = clauses[0] ?? clean;
  for (const c of clauses.slice(1)) if (score(c) > score(best) + 2) best = c;

  let words = best.replace(LEAD_IN, "").split(/\s+/).filter(Boolean);
  if (words.length < 2) words = best.split(/\s+/).filter(Boolean);
  while (words.length > 1 && FILLERS.has(normalizeWord(words[0]))) words.shift();
  let out = words.slice(0, maxWords);
  if (words.length > maxWords) {
    while (out.length > 2 && STOPWORDS.has(normalizeWord(out[out.length - 1]))) out = out.slice(0, -1);
  }
  const line = out.join(" ").replace(/[,;:.!?…—–-]+$/, "");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

const SUFFIXES: Record<string, string> = {
  "%": "%",
  percent: "%",
  x: "x",
  times: "x",
  k: "K",
  thousand: "K",
  m: "M",
  million: "M",
  bn: "B",
  billion: "B",
  trillion: "T",
};

/** The most striking number in a sentence ("$4.5 million", "73%"), if any. */
export function findStat(sentence: string): Omit<Extract<BeatContent, { kind: "stat" }>, "kind" | "label" | "icon"> | null {
  const re = /([$€£])?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s?(%|percent|times|thousand|million|billion|trillion|bn|k|m|x)\b|%)?/gi;
  let best: { score: number; value: number; prefix: string; suffix: string } | null = null;
  for (const m of sentence.matchAll(re)) {
    const value = Number(m[2].replace(/,/g, ""));
    const suffix = SUFFIXES[(m[3] ?? (m[0].endsWith("%") ? "%" : "")).toLowerCase()] ?? "";
    const prefix = m[1] ?? "";
    const bare = !prefix && !suffix;
    // A bare single digit ("3 reasons") or a year ("by 2030") isn't worth a big counter.
    if (bare && (value < 10 || (Number.isInteger(value) && value >= 1000 && value <= 2100))) continue;
    const score = (bare ? 0 : 2) + (value >= 10 ? 1 : 0);
    if (!best || score > best.score) best = { score, value, prefix, suffix };
  }
  return best ? { value: best.value, decimals: decimalsOf(best.value), prefix: best.prefix, suffix: best.suffix } : null;
}

/** "7 out of 10", "1 in 4" or "73 percent", as a pictogram's filled/total. */
export function findRatio(sentence: string): { filled: number; total: number } | null {
  const m = /\b(\d{1,3})\s+(?:out\s+of|in)\s+(?:every\s+)?(\d{1,3})\b/i.exec(sentence);
  if (m) {
    const filled = Number(m[1]);
    const total = Number(m[2]);
    if (filled <= total && ((total >= 2 && total <= 20) || total === 100)) return { filled, total };
  }
  const p = /\b(\d{1,3})\s?(?:%|percent\b)/i.exec(sentence);
  if (p && Number(p[1]) >= 1 && Number(p[1]) <= 100) return { filled: Number(p[1]), total: 100 };
  return null;
}

/** Labels that run in order (years, months, quarters, weeks…) suit a line chart better than bars. */
const sequential = (labels: string[]) =>
  labels.length >= 3 &&
  labels.every((l) => /^(\d{4}|q[1-4]|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|(week|day|month|year|step)\s*\d+)$/i.test(l.trim()));

/** A grid of figures only makes sense when the numbers are about people. */
const PEOPLE = /(people|persons?|owners?|users?|drivers?|customers?|buyers?|men|women|kids|children|adults|students|workers|employees|americans|of us|everyone|families|households|athletes|players)/i;

const SEQUENCE_WORDS = /\b(first|firstly|second|then|next|after that|finally|step|lastly)\b/i;

/** "Day 47", "30 days in a row", "for 21 days": a streak worth a calendar. */
export function findStreak(sentence: string): { marked: number; total: number } | null {
  const m = /\bday\s+(\d{1,3})\b/i.exec(sentence) ?? /\b(\d{1,3})\s+(?:straight\s+|consecutive\s+)?days?\b/i.exec(sentence);
  if (!m) return null;
  const marked = Number(m[1]);
  return marked >= 5 && marked <= 100 ? { marked, total: streakTotal(marked) } : null;
}

/**
 * Beats for one segment without AI, one per ~6 s of narration. Mostly
 * kinetic typography of the narration itself; a number, a streak, a ratio,
 * a process or the user's data becomes a counter, calendar, figure grid,
 * timeline or chart instead.
 */
export function basicBeats(sentences: Sentence[], seg: { start: number; end: number }, words: TimedWord[], charts: DataChart[]): AnimBeat[] {
  if (!sentences.length) return [{ kind: "words", emphasis: [], start: seg.start, end: seg.end }];
  const groups: number[][] = [];
  let cur: number[] = [];
  sentences.forEach((s, i) => {
    cur.push(i);
    if (s.end - sentences[cur[0]].start >= 6 || cur.length >= 4) {
      groups.push(cur);
      cur = [];
    }
  });
  if (cur.length) {
    if (groups.length && sentences[cur[cur.length - 1]].end - sentences[cur[0]].start < MIN_BEAT_SECONDS) groups[groups.length - 1].push(...cur);
    else groups.push(cur);
  }

  // Put each chart where the narration mentions its labels most (never over the opening beat).
  const chartAt = new Map<number, DataChart>();
  for (const chart of charts) {
    const keys = chart.bars.flatMap((b) => keyTokens(b.label)).concat(keyTokens(chart.title ?? ""));
    let best = -1;
    let bestScore = 0;
    groups.forEach((g, gi) => {
      if (gi === 0 && groups.length > 1) return;
      if (chartAt.has(gi)) return;
      const spoken = g.flatMap((i) => keyTokens(sentences[i].text));
      // On a tie, prefer a stretch without its own number, so that one still gets a counter.
      const hasStat = g.some((i) => findStat(sentences[i].text));
      const score = keys.filter((k) => spoken.some((w) => sameWord(k, w))).length - (hasStat ? 0.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = gi;
      }
    });
    if (best < 0) {
      best = groups.findIndex((_, gi) => (gi > 0 || groups.length === 1) && !chartAt.has(gi) && gi >= groups.length / 2);
    }
    if (best >= 0) chartAt.set(best, chart);
  }

  let previous: BeatContent["kind"] | null = null;
  let turn = 0;
  // A chart that lands right after another data moment waits for the next free slot.
  let pending: DataChart | null = null;
  const drafts: BeatDraft[] = groups.map((g, gi) => {
    const lines = g.map((i) => sentences[i].text);
    const all = lines.join(" ");
    const chart = pending ?? chartAt.get(gi) ?? null;
    pending = null;
    // Never two data moments in a row: the narration's words get their turn in between.
    const numeric = previous === null || previous === "words";
    const at = (find: (s: string) => unknown) => (numeric ? g.findIndex((i) => find(sentences[i].text)) : -1);
    const streakIdx = at(findStreak);
    const ratioIdx = at(findRatio);
    const statIdx = at(findStat);
    let content: BeatContent;
    if (chart && !numeric) pending = chart;
    if (chart && numeric) {
      content = sequential(chart.bars.map((b) => b.label))
        ? { kind: "line", title: chart.title, unit: chart.unit, points: chart.bars }
        : { kind: "bars", title: chart.title, unit: chart.unit, bars: chart.bars };
    } else if (streakIdx >= 0) {
      const line = lines[streakIdx];
      content = { kind: "streak", ...findStreak(line)!, label: headline(line, 8, true) };
    } else if (ratioIdx >= 0 && PEOPLE.test(lines[ratioIdx]) && (turn % 2 === 0 || statIdx < 0)) {
      const line = lines[ratioIdx];
      content = { kind: "pictogram", ...findRatio(line)!, label: headline(line, 8, true) };
      turn++;
    } else if (statIdx >= 0) {
      const line = lines[statIdx];
      content = { kind: "stat", ...findStat(line)!, label: headline(line, 8, true) };
      turn++;
    } else if (numeric && gi > 0 && lines.length >= 3 && lines.length <= 5 && SEQUENCE_WORDS.test(all)) {
      content = { kind: "steps", title: null, items: lines.map((l) => ({ text: headline(l, 5), at: NaN })) };
    } else {
      content = { kind: "words", emphasis: [] };
    }
    previous = content.kind;
    return { sentence: g[0], content };
  });
  return timeBeats(drafts, sentences, seg, words);
}

/** The offline plan for every animated segment. */
export function basicAnimation(words: TimedWord[], segments: { start: number; end: number }[], data: string): AnimationPlan {
  const charts = parseDataCharts(data);
  // Hand each chart to the segment whose narration mentions it most; the rest go round in turn.
  const perSegment: DataChart[][] = segments.map(() => []);
  const spoken = segments.map((s) => keyTokens(sentencesIn(words, s.start, s.end).map((x) => x.text).join(" ")));
  charts.forEach((chart, ci) => {
    const keys = chart.bars.flatMap((b) => keyTokens(b.label)).concat(keyTokens(chart.title ?? ""));
    const scores = spoken.map((sp) => keys.filter((k) => sp.some((w) => sameWord(k, w))).length);
    const top = Math.max(...scores);
    perSegment[top > 0 ? scores.indexOf(top) : ci % segments.length].push(chart);
  });
  return {
    source: "basic",
    segments: segments.map((seg, k) => ({
      start: seg.start,
      end: seg.end,
      beats: basicBeats(sentencesIn(words, seg.start, seg.end), seg, words, perSegment[k]),
    })),
  };
}

// ---------------------------------------------------------------------------
// Validation of a plan sent back by the browser
// ---------------------------------------------------------------------------

/** Check an animation plan from an untrusted source; null if anything is off. */
export function cleanAnimationPlan(raw: unknown, duration: number): AnimationPlan | null {
  if (!isObj(raw) || !Array.isArray(raw.segments) || raw.segments.length === 0 || raw.segments.length > 60) return null;
  const segments: AnimatedSegment[] = [];
  for (const s of raw.segments) {
    if (!isObj(s) || !num(s.start) || !num(s.end) || s.start < 0 || s.end <= s.start || s.end > duration + 0.5) return null;
    if (!Array.isArray(s.beats) || s.beats.length === 0 || s.beats.length > MAX_BEATS_PER_SEGMENT) return null;
    if (segments.length && s.start < segments[segments.length - 1].end - 0.01) return null;
    const beats: AnimBeat[] = [];
    for (const b of s.beats) {
      const content = cleanBeatContent(b);
      if (!content || !isObj(b) || !num(b.start) || !num(b.end)) return null;
      const start = Math.max(s.start, b.start);
      const end = Math.min(s.end, b.end);
      if (end <= start || (beats.length && start < beats[beats.length - 1].start)) return null;
      const beat = { ...content, start, end } as AnimBeat;
      if (beat.kind === "bullets" || beat.kind === "steps") {
        beat.items = beat.items.map((it, i) => ({
          ...it,
          at: Number.isFinite(it.at) ? Math.min(Math.max(it.at, start), end) : start + 0.6 + i * 0.8,
        }));
      }
      beats.push(beat);
    }
    segments.push({ start: s.start, end: s.end, beats });
  }
  return { segments, source: raw.source === "llm" ? "llm" : "basic" };
}

// ---------------------------------------------------------------------------
// Timeline and look
// ---------------------------------------------------------------------------

export type Shot =
  | { kind: "image"; start: number; end: number; image: number }
  | ({ kind: "animated" } & AnimatedSegment);

/** Photo scenes and animated segments merged into one ordered list of shots. */
export function timelineShots(timing: Pick<Timing, "scenes"> & { animation?: AnimationPlan | null }): Shot[] {
  const shots: Shot[] = [
    ...timing.scenes.map((s, i) => ({ kind: "image" as const, start: s.start, end: s.end, image: s.image ?? i })),
    ...(timing.animation?.segments ?? []).map((seg) => ({ kind: "animated" as const, ...seg })),
  ];
  return shots.sort((a, b) => a.start - b.start);
}

export type AnimationTheme = {
  /** Dark base colours, used behind charts and where no photo shows. */
  bg: [string, string];
  accent: string;
  accent2: string;
  text: string;
  muted: string;
  heading: FontKey;
  body: FontKey;
  uppercase: boolean;
  /** Colour washed over the photos so every chunk shares one grade. */
  tint: string;
  /** What floats through the air. */
  particles: "dust" | "embers" | "bokeh" | "snow" | "digital";
  /** How one moment cuts to the next. */
  cut: "flash" | "burn" | "glitch" | "fade";
};

const NICHE_THEMES: Record<NicheId, Pick<AnimationTheme, "bg" | "accent2" | "tint" | "particles" | "cut">> = {
  general: { bg: ["#0b0f1a", "#18223a"], accent2: "#60A5FA", tint: "rgba(20,30,60,0.35)", particles: "dust", cut: "fade" },
  tech: { bg: ["#050914", "#0c2146"], accent2: "#8B5CF6", tint: "rgba(10,40,100,0.4)", particles: "digital", cut: "glitch" },
  travel: { bg: ["#0a1a1c", "#1d3a38"], accent2: "#FF7A59", tint: "rgba(110,60,10,0.25)", particles: "bokeh", cut: "burn" },
  business: { bg: ["#0b1220", "#172a4a"], accent2: "#34D399", tint: "rgba(10,25,55,0.4)", particles: "bokeh", cut: "fade" },
  fitness: { bg: ["#0c0606", "#2a0e0e"], accent2: "#FFB020", tint: "rgba(50,0,0,0.3)", particles: "embers", cut: "flash" },
  food: { bg: ["#1a0d06", "#3a1d0c"], accent2: "#FFD166", tint: "rgba(90,35,0,0.25)", particles: "bokeh", cut: "burn" },
  gaming: { bg: ["#0c0420", "#2a0b4d"], accent2: "#FF2E88", tint: "rgba(70,0,110,0.35)", particles: "digital", cut: "glitch" },
  documentary: { bg: ["#120e09", "#2a2116"], accent2: "#C8B79A", tint: "rgba(50,34,12,0.35)", particles: "dust", cut: "burn" },
};

/** A #rrggbb accent, lightened towards white if it's too dark to read on the dark backgrounds (e.g. deep blue). */
function readable(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  // WCAG relative luminance; below 0.2 the contrast with the backgrounds drops under ~4:1.
  const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  if (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) >= 0.2) return hex;
  const mix = (c: number) => Math.round(c + (255 - c) * 0.4).toString(16).padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

/** Colours, fonts and effects of the animated segments: the niche's look with the caption style's font and highlight. */
export function animationTheme(niche: NicheId, caption: CaptionStyleId): AnimationTheme {
  const look = CAPTION_LOOKS[caption] ?? CAPTION_LOOKS.bold;
  const base = NICHE_THEMES[niche] ?? NICHE_THEMES.general;
  return {
    ...base,
    accent: readable(look.highlight),
    text: "#ffffff",
    muted: "rgba(255,255,255,0.72)",
    heading: look.font,
    body: "inter",
    uppercase: look.uppercase,
  };
}

// ---------------------------------------------------------------------------
// Kinetic typography
// ---------------------------------------------------------------------------

/** Common words that never deserve the spotlight in kinetic type. */
const WEAK = new Set(
  (
    "there here have has had were been being about every really today going gonna because would could should " +
    "their them they these those what when where which while with without into onto your yours just still also " +
    "even ever never much many very thing things something someone everyone anyone"
  ).split(" "),
);

/** How one group of words is set on screen. */
export type KineticLayout = "stack" | "line" | "hero";

export type KineticCard = {
  words: TimedWord[];
  /** Seconds on the video's timeline. */
  start: number;
  end: number;
  layout: KineticLayout;
  /** Index (into `words`) of the word drawn big and in the accent colour. */
  key: number;
};

const PHRASE_END = /[.!?…,;:—–]["')\]”’]*$/;
/** "a.m.", "U.S.", "Dr." end with a full stop but not a phrase. */
const ABBREVIATION = /^(?:(?:\p{L}\.){2,}|mr\.|mrs\.|ms\.|dr\.|st\.|vs\.|etc\.|no\.)$/iu;

/**
 * Cut the narration between two times into the short phrases kinetic
 * typography shows one at a time (breaking at punctuation, pauses or
 * `maxWords`), each with a layout and the word to emphasise: one the AI
 * picked, else a number, else the longest meaningful word.
 */
export function kineticCards(words: TimedWord[], start: number, end: number, maxWords: number, emphasis: string[] = []): KineticCard[] {
  const inside = wordsIn(words, start, end);
  const groups: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  inside.forEach((w, i) => {
    cur.push(w);
    const next = inside[i + 1];
    const ends = PHRASE_END.test(w.text) && !ABBREVIATION.test(w.text);
    if (!next || ends || next.start - w.end > 0.45 || cur.length >= maxWords) {
      groups.push(cur);
      cur = [];
    }
  });
  const wanted = new Set(emphasis.map(normalizeWord));
  const plain = (w: string) => STOPWORDS.has(w) || WEAK.has(w);
  const layouts: KineticLayout[] = ["stack", "line", "hero", "stack", "line"];
  return groups.map((g, i) => {
    const norm = g.map((w) => normalizeWord(w.text));
    let key = norm.findIndex((w) => wanted.has(w));
    if (key < 0) key = g.findIndex((w) => /\d/.test(w.text));
    if (key < 0) {
      let best = -1;
      norm.forEach((w, j) => {
        if (!plain(w) && w.length >= 3 && (best < 0 || w.length > norm[best].length)) best = j;
      });
      key = best >= 0 ? best : g.length - 1;
    }
    const cardStart = i === 0 ? start : Math.max(start, g[0].start - 0.08);
    const nextStart = i + 1 < groups.length ? Math.max(start, groups[i + 1][0].start - 0.08) : end;
    return {
      words: g,
      start: cardStart,
      end: nextStart,
      layout: g.length === 1 ? "hero" : layouts[i % layouts.length],
      key,
    };
  });
}

/** "1,200", "3.5", "1969" (no separator in year-like numbers). */
export function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: Math.abs(value) >= 10000,
  });
}
