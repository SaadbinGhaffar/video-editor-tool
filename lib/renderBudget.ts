import { FPS } from "./types";

// Measured on Vercel Sandbox: about 1 frame per second per vCPU for 1080p
// with a heavy whole-video effect (4.5–5 fps on 4 vCPUs), so this
// errs on the slow side; plain styles render faster.
const FRAMES_PER_SECOND_PER_VCPU = 1;
/** Booting the render machine, uploading the template and saving the MP4. */
const OVERHEAD_MINUTES = 1.5;
/** Leave this much of the session unused, so the render never races the hard stop. */
const SAFETY_MINUTES = 3.5;

export type RenderBudget = { vcpus: number; maxMinutes: number };

/**
 * The Vercel Sandbox each render runs in. Defaults fit the Hobby plan (4 vCPUs,
 * 45-minute sessions); on Pro set SANDBOX_VCPUS=8 and a longer
 * SANDBOX_MAX_MINUTES (up to 1440) for faster renders and longer videos.
 */
export const SANDBOX_BUDGET: RenderBudget = {
  vcpus: Number(process.env.SANDBOX_VCPUS) || 4,
  maxMinutes: Number(process.env.SANDBOX_MAX_MINUTES) || 45,
};

/** Minutes a video of this length takes to render in the sandbox. */
export function estimateRenderMinutes(durationInSeconds: number, budget: RenderBudget): number {
  const frames = durationInSeconds * FPS;
  return frames / (budget.vcpus * FRAMES_PER_SECOND_PER_VCPU) / 60 + OVERHEAD_MINUTES;
}

/** Longest video (in seconds) that reliably finishes within one sandbox session. */
export function maxVideoSeconds(budget: RenderBudget): number {
  const renderMinutes = budget.maxMinutes - OVERHEAD_MINUTES - SAFETY_MINUTES;
  return Math.max(0, Math.floor((renderMinutes * 60 * budget.vcpus * FRAMES_PER_SECOND_PER_VCPU) / FPS));
}
