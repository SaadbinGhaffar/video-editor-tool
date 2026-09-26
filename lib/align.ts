import type { CaptionCue, TimedWord } from "./types";

/**
 * Split the user's transcript into display words, keeping their exact
 * spelling, casing and punctuation. Stray punctuation tokens ("—", "-")
 * are glued onto the previous word so they never become their own caption.
 */
export function tokenizeTranscript(text: string): string[] {
  const raw = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  for (const token of raw) {
    if (normalizeWord(token) === "" && out.length > 0) {
      out[out.length - 1] += ` ${token}`;
    } else {
      out.push(token);
    }
  }
  return out;
}

/** Lowercase, strip diacritics and everything that isn't a letter or digit. */
export function normalizeWord(word: string): string {
  return word
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common. */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

const GAP_COST = 1;
/** Pairs at least this similar are treated as the same word ("anchors"). */
const ANCHOR_SIMILARITY = 0.7;

function substitutionCost(sim: number): number {
  // Identical words are free. Any real substitution costs at least 0.4 and at
  // most 1.6, so it is always cheaper than two gaps (2.0): the alignment keeps
  // words paired up position-for-position when the wording differs.
  return sim === 1 ? 0 : 0.4 + 1.2 * (1 - sim);
}

/**
 * Needleman-Wunsch global alignment between two normalized word sequences.
 * Returns, for every user word, the index of the recognized word it is paired
 * with (or -1 when the user word is aligned to a gap).
 */
export function alignSequences(user: string[], recognized: string[]): number[] {
  const n = user.length;
  const m = recognized.length;
  const cols = m + 1;
  const cost = new Float64Array((n + 1) * cols);
  // 0 = diagonal, 1 = up (user word vs gap), 2 = left (recognized word vs gap)
  const move = new Uint8Array((n + 1) * cols);

  for (let i = 1; i <= n; i++) {
    cost[i * cols] = i * GAP_COST;
    move[i * cols] = 1;
  }
  for (let j = 1; j <= m; j++) {
    cost[j] = j * GAP_COST;
    move[j] = 2;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = wordSimilarity(user[i - 1], recognized[j - 1]);
      const diag = cost[(i - 1) * cols + (j - 1)] + substitutionCost(sim);
      const up = cost[(i - 1) * cols + j] + GAP_COST;
      const left = cost[i * cols + (j - 1)] + GAP_COST;
      let best = diag;
      let dir = 0;
      if (up < best) {
        best = up;
        dir = 1;
      }
      if (left < best) {
        best = left;
        dir = 2;
      }
      cost[i * cols + j] = best;
      move[i * cols + j] = dir;
    }
  }

  const pairing = new Array<number>(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const dir = move[i * cols + j];
    if (i > 0 && j > 0 && dir === 0) {
      pairing[i - 1] = j - 1;
      i--;
      j--;
    } else if (i > 0 && (j === 0 || dir === 1)) {
      i--;
    } else {
      j--;
    }
  }
  return pairing;
}

/** Rough per-word duration used when there's no timing evidence at all. */
const FALLBACK_WORD_SECONDS = 0.3;

/**
 * Put the user's exact transcript onto the recognizer's word timings.
 *
 * Words that align to a close-enough recognized word inherit its timing
 * directly. Runs of unmatched user words are spread across the time between
 * their nearest matched neighbours — narrowed to the span of any unmatched
 * recognized words in that gap, since that's where the sound actually is —
 * weighted by word length.
 */
export function alignTranscript(
  transcript: string,
  recognized: TimedWord[],
  audioDuration: number,
): TimedWord[] {
  const display = tokenizeTranscript(transcript);
  if (display.length === 0) return [];

  const userNorm = display.map(normalizeWord);
  const recNorm = recognized.map((w) => normalizeWord(w.text));
  const pairing = recognized.length ? alignSequences(userNorm, recNorm) : [];

  // anchor[i] = recognized index for user word i, when it's a confident match.
  const anchor = display.map((_, i) => {
    const j = pairing[i] ?? -1;
    if (j < 0) return -1;
    return wordSimilarity(userNorm[i], recNorm[j]) >= ANCHOR_SIMILARITY ? j : -1;
  });

  const result: TimedWord[] = display.map((text, i) =>
    anchor[i] >= 0
      ? { text, start: recognized[anchor[i]].start, end: recognized[anchor[i]].end }
      : { text, start: NaN, end: NaN },
  );

  const hasAnyAnchor = anchor.some((a) => a >= 0);
  if (!hasAnyAnchor) {
    // Nothing matched: use the full recognized speech span, or the whole file.
    const start = recognized.length ? recognized[0].start : 0;
    const end = recognized.length ? recognized[recognized.length - 1].end : audioDuration;
    distribute(result, 0, result.length - 1, start, Math.max(end, start + 0.1));
    return enforceMonotonic(result, audioDuration);
  }

  let i = 0;
  while (i < result.length) {
    if (anchor[i] >= 0) {
      i++;
      continue;
    }
    const runStart = i;
    while (i < result.length && anchor[i] < 0) i++;
    const runEnd = i - 1;
    const count = runEnd - runStart + 1;

    const prevUser = runStart - 1;
    const nextUser = runEnd + 1 < result.length ? runEnd + 1 : -1;
    const prevRec = prevUser >= 0 ? anchor[prevUser] : -1;
    const nextRec = nextUser >= 0 ? anchor[nextUser] : recognized.length;

    // Recognized words that sit between the two anchors and weren't matched.
    const gapFirst = prevRec + 1;
    const gapLast = nextRec - 1;

    let winStart: number;
    let winEnd: number;
    if (gapFirst <= gapLast) {
      winStart = recognized[gapFirst].start;
      winEnd = recognized[gapLast].end;
    } else if (prevUser >= 0 && nextUser >= 0) {
      winStart = result[prevUser].end;
      winEnd = result[nextUser].start;
    } else if (nextUser >= 0) {
      // Leading words the recognizer never heard: place just before the first match.
      winEnd = result[nextUser].start;
      winStart = Math.max(0, winEnd - count * FALLBACK_WORD_SECONDS);
    } else {
      // Trailing words the recognizer never heard: place just after the last match.
      winStart = result[prevUser].end;
      winEnd = Math.min(audioDuration, winStart + count * FALLBACK_WORD_SECONDS);
    }
    if (prevUser >= 0) winStart = Math.max(winStart, result[prevUser].end);
    if (nextUser >= 0) winEnd = Math.min(winEnd, result[nextUser].start);
    if (winEnd < winStart) winEnd = winStart;

    distribute(result, runStart, runEnd, winStart, winEnd);
  }

  return enforceMonotonic(result, audioDuration);
}

/** Spread words[from..to] over [start, end], weighted by word length. */
function distribute(words: TimedWord[], from: number, to: number, start: number, end: number) {
  const weights: number[] = [];
  for (let k = from; k <= to; k++) weights.push(normalizeWord(words[k].text).length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = start;
  for (let k = from; k <= to; k++) {
    const d = ((end - start) * weights[k - from]) / total;
    words[k].start = t;
    words[k].end = t + d;
    t += d;
  }
}

/**
 * Recognizers often stretch the last word of a sentence across the silence
 * that follows it. No real word lasts this long, so trim it back.
 */
const MAX_WORD_SECONDS = 1.2;

function enforceMonotonic(words: TimedWord[], audioDuration: number): TimedWord[] {
  let last = 0;
  for (const w of words) {
    w.start = Math.min(Math.max(w.start, last), audioDuration);
    w.end = Math.min(Math.max(w.end, w.start), w.start + MAX_WORD_SECONDS, audioDuration);
    last = w.start;
  }
  return words;
}

export type CueOptions = {
  maxWords?: number;
  maxChars?: number;
  /** Silence (seconds) long enough to force a new cue. */
  pauseBreak?: number;
};

/**
 * Group timed words into short caption cues (1–4 words), breaking on
 * sentence punctuation, commas and pauses so each cue reads as a phrase.
 */
export function groupIntoCues(words: TimedWord[], opts: CueOptions = {}): CaptionCue[] {
  const maxWords = opts.maxWords ?? 4;
  const maxChars = opts.maxChars ?? 22;
  const pauseBreak = opts.pauseBreak ?? 0.6;

  const groups: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  const charLen = (ws: TimedWord[]) => ws.reduce((n, w) => n + w.text.length, 0) + Math.max(0, ws.length - 1);
  const endsSentence = (w: TimedWord) => /[.!?…;:]["')\]”’]*$/.test(w.text);
  const endsWithPunct = (w: TimedWord) => /[.!?…;:,—–-]["')\]”’]*$/.test(w.text);

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length > 0 && charLen([...cur, w]) > maxChars) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    const next = words[i + 1];
    const endsClause = /[,—–-]["')\]”’]*$/.test(w.text) && cur.length >= 2;
    const pause = next ? next.start - w.end >= pauseBreak : false;
    if (!next || endsSentence(w) || endsClause || pause || cur.length >= maxWords) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);

  // Avoid lone words dangling at the end of a phrase ("…a foggy forest" /
  // "road."): pull them back into the previous cue if it fits, otherwise
  // borrow that cue's last word so both read as phrases.
  for (let gi = 1; gi < groups.length; gi++) {
    const g = groups[gi];
    const prev = groups[gi - 1];
    const prevLast = prev[prev.length - 1];
    if (g.length !== 1 || endsWithPunct(prevLast) || g[0].start - prevLast.end > 0.9) continue;
    if (prev.length < maxWords && charLen([...prev, ...g]) <= maxChars) {
      prev.push(...g);
      groups.splice(gi, 1);
      gi--;
    } else if (prev.length >= 3 && charLen([prevLast, ...g]) <= maxChars) {
      groups[gi] = [prev.pop()!, ...g];
    }
  }

  return groups.map((ws, gi) => {
    const start = ws[0].start;
    const lastEnd = ws[ws.length - 1].end;
    const nextStart = groups[gi + 1]?.[0].start;
    // Hold each cue until the next one starts if the gap is short (avoids
    // flicker); otherwise linger briefly after the last word.
    let end = lastEnd + 0.6;
    if (nextStart !== undefined && (nextStart - lastEnd < 0.8 || end > nextStart)) {
      end = Math.max(lastEnd, nextStart);
    }
    return { start, end, words: ws };
  });
}

/**
 * Decide where each image's slice of the timeline starts. Returns scene
 * boundaries in seconds (length = imageCount + 1, first 0, last duration).
 *
 * Starts from an even split, then nudges each cut to a nearby sentence end
 * or pause so image changes land between phrases rather than mid-word.
 */
export function planSceneBoundaries(
  words: TimedWord[],
  duration: number,
  imageCount: number,
  minSceneSeconds: number,
): number[] {
  const slice = duration / imageCount;
  const even = Array.from({ length: imageCount + 1 }, (_, k) => k * slice);
  if (imageCount < 2 || words.length < 2) return even;

  const candidates: { time: number; score: number }[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i];
    const b = words[i + 1];
    const pause = Math.max(0, b.start - a.end);
    const sentence = /[.!?…]["')\]”’]*$/.test(a.text) ? 2 : /[,;:—–]["')\]”’]*$/.test(a.text) ? 0.7 : 0;
    candidates.push({ time: (a.end + b.start) / 2, score: sentence + Math.min(pause, 1.5) * 2 });
  }

  const bounds = [0];
  for (let k = 1; k < imageCount; k++) {
    const target = even[k];
    const reach = slice * 0.35;
    const lo = bounds[k - 1] + minSceneSeconds;
    const hi = duration - (imageCount - k) * minSceneSeconds;
    let best = Math.min(Math.max(target, lo), hi);
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (Math.abs(c.time - target) > reach || c.time < lo || c.time > hi) continue;
      const s = c.score - Math.abs(c.time - target) / slice;
      if (s > bestScore) {
        bestScore = s;
        best = c.time;
      }
    }
    // Only move the cut if the candidate is actually a phrase break.
    bounds.push(bestScore > 0.3 ? best : Math.min(Math.max(target, lo), hi));
  }
  bounds.push(duration);
  return bounds;
}
