import type { VideoEffectId } from "./types";

export type VideoEffectLook = {
  label: string;
  description: string;
  /**
   * CSS filter for the picture (captions stay untouched). `url(#ve-…)` refers
   * to an SVG filter the composition draws (remotion/videoEffects.tsx).
   */
  filter: string;
  vignette: number;
  grain: number;
  /** Height of the widescreen bars at 1080p, in px (0 = none). */
  letterbox: number;
};

export const VIDEO_EFFECT_LOOKS: Record<Exclude<VideoEffectId, "none">, VideoEffectLook> = {
  cinematic: {
    label: "Cinematic",
    description: "Teal-and-orange film grade with 2.39:1 widescreen bars.",
    filter: "url(#ve-cinematic) contrast(1.08) saturate(1.08)",
    vignette: 0.35,
    grain: 0.03,
    // 1080 − 1920 / 2.39 ≈ 277 px, split top and bottom.
    letterbox: 138,
  },
  vintage: {
    label: "Vintage film",
    description: "Faded warm film stock with grain, flicker, dust and gate weave.",
    filter: "sepia(0.42) saturate(0.78) contrast(0.9) brightness(1.05)",
    vignette: 0.6,
    grain: 0.1,
    letterbox: 0,
  },
  noir: {
    label: "Black & white",
    description: "High-contrast monochrome with a soft vignette and fine grain.",
    filter: "grayscale(1) contrast(1.28) brightness(1.02)",
    vignette: 0.5,
    grain: 0.06,
    letterbox: 0,
  },
  dreamy: {
    label: "Dreamy glow",
    description: "Soft bloom on the highlights, gentle colour and drifting light.",
    filter: "url(#ve-dreamy) saturate(1.08) brightness(1.03)",
    vignette: 0.15,
    grain: 0.02,
    letterbox: 0,
  },
  vhs: {
    label: "VHS retro",
    description: "Colour fringing, scanlines, tape noise and tracking glitches.",
    filter: "url(#ve-vhs) saturate(1.3) contrast(1.06) blur(0.6px)",
    vignette: 0.35,
    grain: 0.08,
    letterbox: 0,
  },
};

export const effectLook = (id: VideoEffectId): VideoEffectLook | null => (id === "none" ? null : VIDEO_EFFECT_LOOKS[id]);
