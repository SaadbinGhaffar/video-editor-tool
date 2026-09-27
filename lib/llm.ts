import "server-only";
import OpenAI, { type ClientOptions } from "openai";

/**
 * The hosted speech-to-text / LLM provider. Both speak the OpenAI API, so the
 * same client works for either; OpenAI wins if both keys are set.
 */
export type AiProvider = {
  name: "OpenAI" | "Groq";
  envVar: "OPENAI_API_KEY" | "GROQ_API_KEY";
  sttModel: string;
  chatModel: string;
  client: (options?: ClientOptions) => OpenAI;
};

export function aiProvider(): AiProvider | null {
  if (process.env.OPENAI_API_KEY) {
    return {
      name: "OpenAI",
      envVar: "OPENAI_API_KEY",
      sttModel: "whisper-1",
      chatModel: process.env.NICHE_MODEL || "gpt-4.1-mini",
      client: (options) => new OpenAI(options),
    };
  }
  if (process.env.GROQ_API_KEY) {
    return {
      name: "Groq",
      envVar: "GROQ_API_KEY",
      sttModel: "whisper-large-v3-turbo",
      chatModel: process.env.NICHE_MODEL || "qwen/qwen3.8-27b",
      client: (options) =>
        new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1", ...options }),
    };
  }
  return null;
}
