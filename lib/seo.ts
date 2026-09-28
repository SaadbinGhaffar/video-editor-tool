import "server-only";
import { aiProvider } from "./llm";
import { NICHE_LABELS } from "./niche";
import { basicSeo, cleanSeo } from "./seoText";
import type { NicheId, SeoPack, VideoFormat } from "./types";

const SYSTEM_PROMPT = `You are a YouTube SEO specialist. From a video's narration transcript, write metadata that ranks in YouTube and Google search and earns clicks without misleading anyone.
Rules:
- Write in the same language as the transcript.
- title: 50–70 characters. Put the main search keyword in the first half. Specific and compelling; no ALL-CAPS words, no emojis, no quotation marks, no clickbait the video doesn't deliver.
- description: at least 150 words, plain text, paragraphs separated by a blank line. Paragraph 1: two sentences, under 160 characters in total, that hook the viewer and contain the main keyword. Then 2–3 paragraphs on what the viewer will learn or see, weaving in related keywords naturally (no stuffing). Last paragraph: one call-to-action sentence (like, subscribe, comment). No hashtags in the description.
- hashtags: 3–5 relevant hashtags without the # sign, no spaces.
- tags: 10–15 search phrases people would type, most important first, each under 30 characters, lowercase.
Reply with JSON only: {"title": "...", "description": "...", "hashtags": ["..."], "tags": ["..."]}`;

/** Shorts are browsed on phones: shorter title and description, and #shorts. */
const SHORTS_RULES = `This is a YouTube Short (vertical video). Override the lengths above: title 40–60 characters; description 60–120 words in 2–3 short paragraphs plus the call to action; the first hashtag must be "shorts".`;

/**
 * YouTube title, description and tags for a rendered video, written by the
 * configured AI model from the transcript. Falls back to a simple offline
 * version if no model is configured or the call fails, so it never errors.
 */
export async function writeSeo(
  transcript: string,
  niche: NicheId,
  durationInSeconds: number,
  format: VideoFormat = "landscape",
): Promise<SeoPack> {
  const shorts = format === "shorts";
  const provider = aiProvider();
  if (!provider) return basicSeo(transcript, niche, shorts);

  const model = provider.seoModel;
  try {
    const client = provider.client({ timeout: 30_000, maxRetries: 1 });
    const minutes = Math.floor(durationInSeconds / 60);
    const seconds = Math.round(durationInSeconds % 60);
    const res = await client.chat.completions.create({
      model,
      // Reasoning models (gpt-oss) spend output tokens thinking first; keep that short.
      ...(/gpt-oss|^o\d/.test(model) ? { reasoning_effort: "low" as const } : {}),
      max_completion_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: shorts ? `${SYSTEM_PROMPT}\n\n${SHORTS_RULES}` : SYSTEM_PROMPT },
        {
          role: "user",
          content: `Format: ${shorts ? "YouTube Short" : "YouTube video"}. Niche: ${NICHE_LABELS[niche]}. Video length: ${minutes ? `${minutes} min ` : ""}${seconds} s.\n\nTranscript:\n${transcript.slice(0, 12_000)}`,
        },
      ],
    });
    const pack = cleanSeo(JSON.parse(res.choices[0]?.message?.content ?? "null"), shorts);
    if (pack) return { ...pack, source: "llm" };
    console.warn("[seo] model reply was unusable, using the basic version");
  } catch (err) {
    console.warn(`[seo] ${model} failed, using the basic version:`, err instanceof Error ? err.message : err);
  }
  return basicSeo(transcript, niche, shorts);
}
