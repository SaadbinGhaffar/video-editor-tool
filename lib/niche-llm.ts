import "server-only";
import OpenAI from "openai";
import { detectNicheFromText, NICHE_LABELS } from "./niche";
import { NICHES, type NicheDetection, type NicheId } from "./types";

/**
 * Niche detection. Uses an LLM when OPENAI_API_KEY is set (better at subtle
 * topics), and the offline keyword classifier otherwise — or if the LLM call
 * fails for any reason, so this never blocks a render.
 */
export async function detectNiche(transcript: string): Promise<NicheDetection> {
  const fallback = detectNicheFromText(transcript);
  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const client = new OpenAI({ timeout: 15_000, maxRetries: 1 });
    const options = NICHES.map((n) => `${n} (${NICHE_LABELS[n]})`).join(", ");
    const res = await client.chat.completions.create({
      model: process.env.NICHE_MODEL || "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `Classify the niche of a YouTube narration so an editor can pick a visual style. ` +
            `Options: ${options}. Reply with JSON: {"niche": "<option id>", "confidence": <0-1>, "reason": "<max 8 words>"}. ` +
            `Use "general" if nothing fits clearly.`,
        },
        { role: "user", content: transcript.slice(0, 6000) },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
      niche?: string;
      confidence?: number;
      reason?: string;
    };
    if (!NICHES.includes(parsed.niche as NicheId)) return fallback;
    return {
      niche: parsed.niche as NicheId,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
      signals: parsed.reason ? [parsed.reason] : [],
      source: "llm",
    };
  } catch (err) {
    console.warn("[niche] LLM classification failed, using keywords:", err instanceof Error ? err.message : err);
    return fallback;
  }
}
