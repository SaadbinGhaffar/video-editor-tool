import { NICHE_LABELS } from "./niche";
import type { NicheId, SeoPack } from "./types";

// Pure helpers for the YouTube title/description (lib/seo.ts calls the AI model).

/** YouTube's hard limits. */
export const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5000;
const TAGS_TOTAL_MAX = 500;

const NICHE_HASHTAGS: Record<NicheId, string[]> = {
  general: ["video", "story"],
  tech: ["tech", "technology", "ai"],
  travel: ["travel", "travelvlog", "explore"],
  business: ["business", "entrepreneur", "money"],
  fitness: ["fitness", "workout", "motivation"],
  food: ["food", "recipe", "cooking"],
  gaming: ["gaming", "gamer", "videogames"],
  documentary: ["documentary", "history", "story"],
};

const STOPWORDS = new Set(
  (
    "about after again also always another because been before being between both could does doing down during each " +
    "every from further have having here into just like more most much never only other over really same should some " +
    "such than that their them then there these they this those through today under until very want well were what " +
    "when where which while will with without would your yours youre going thing things know make made gonna okay yeah"
  ).split(" "),
);

/** Normalise typographic characters models like to emit, trim, and collapse runs of blank lines. */
function tidy(text: string): string {
  return text
    .replace(/[‐‑‒–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut at a word boundary so it fits `max` characters. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}

const hashtag = (t: string) => t.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "");

/** Validate and tidy what the model returned; null if it's unusable. */
export function cleanSeo(raw: unknown): Omit<SeoPack, "source"> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? clip(tidy(r.title).replace(/^["']|["']$/g, ""), TITLE_MAX) : "";
  const body = typeof r.description === "string" ? stripTrailingTagLines(tidy(r.description)) : "";
  if (!title || body.length < 40) return null;

  const tags = fitTags(uniqueStrings(r.tags).map((t) => tidy(t).toLowerCase().replace(/[<>,]/g, "")).filter(Boolean));
  const rawHashtags = Array.isArray(r.hashtags) ? r.hashtags : [];
  const hashtags = uniqueStrings(rawHashtags.map((h) => (typeof h === "string" ? hashtag(h) : h))).slice(0, 5);
  return { title, description: composeDescription(body, tags, hashtags), tags };
}

/** The description ends with the tags and then the hashtags, so both go wherever it's pasted. */
function composeDescription(body: string, tags: string[], hashtags: string[]): string {
  const parts = [body];
  if (tags.length) parts.push(`Tags: ${tags.join(", ")}`);
  if (hashtags.length) parts.push(hashtags.map((h) => `#${h}`).join(" "));
  // Trim the body, never the tag and hashtag lines, if it's over YouTube's limit.
  const tail = parts.slice(1).join("\n\n");
  return [clip(body, DESCRIPTION_MAX - tail.length - 2), tail].filter(Boolean).join("\n\n");
}

/** Drop hashtag-only or "Tags:" lines the model added at the end anyway (they're re-added in a fixed format). */
function stripTrailingTagLines(text: string): string {
  const lines = text.split("\n");
  while (lines.length && /^\s*(tags\s*:.*|(#[\p{L}\p{N}_]+[\s,]*)+)?\s*$/iu.test(lines[lines.length - 1])) lines.pop();
  return lines.join("\n").trim();
}

function uniqueStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const key = x.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(x.trim());
  }
  return out;
}

/** YouTube allows 500 characters of tags in total. */
function fitTags(tags: string[]): string[] {
  const out: string[] = [];
  let total = 0;
  for (const t of tags) {
    if (total + t.length + 1 > TAGS_TOTAL_MAX) break;
    out.push(t);
    total += t.length + 1;
  }
  return out;
}

/**
 * Offline fallback when no AI model is configured (or it fails): a title from
 * the opening sentence, the first few sentences as the description, and tags
 * from the transcript's most frequent meaningful words.
 */
export function basicSeo(transcript: string, niche: NicheId): SeoPack {
  const sentences = tidy(transcript)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\b(um+|uh+|erm)\b,?\s*/gi, "").trim())
    .filter((s) => s.split(" ").length >= 3);
  const first = (sentences[0] ?? tidy(transcript)).replace(/[.!?]+$/, "");
  const title = clip(first.charAt(0).toUpperCase() + first.slice(1), 70);

  const counts = new Map<string, number>();
  for (const w of transcript.toLowerCase().match(/\p{L}[\p{L}'-]{3,}/gu) ?? []) {
    const word = w.replace(/'s$/, "");
    if (!STOPWORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const keywords = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
  const label = NICHE_LABELS[niche].toLowerCase();
  const tags = fitTags([...(niche === "general" ? [] : [label]), ...keywords]);

  const summary = sentences.slice(0, 4).join(" ");
  const hashtags = [...new Set([...NICHE_HASHTAGS[niche], ...keywords.slice(0, 2)].map(hashtag))].slice(0, 5);
  const body = [
    summary || tidy(transcript),
    "If you enjoyed this video, like it, subscribe for more, and tell us what you think in the comments.",
  ].join("\n\n");
  return { title, description: composeDescription(body, tags, hashtags), tags, source: "basic" };
}
