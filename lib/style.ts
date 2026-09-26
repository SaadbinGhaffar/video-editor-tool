import { CAPTION_LOOKS, FONTS } from "./captionLooks";
import {
  CAPTION_STYLES,
  FPS,
  type BackgroundMusic,
  type CaptionStyleId,
  type ImageStats,
  type MainVideoProps,
  type NicheId,
  type SceneLook,
  type StylePlan,
  type Timing,
  type TransitionKind,
} from "./types";

// Pure and deterministic: the browser (live preview) and the server (render)
// both call planStyle with the same inputs and get the same plan.

type Grade = { brightness: number; contrast: number; saturate: number; sepia: number; hue: number };

type NichePreset = {
  /** Transitions to rotate through, in preference order. */
  transitions: TransitionKind[];
  /** Base transition length in seconds, before pace adjustment. */
  transitionSeconds: number;
  kenBurns: { zoom: number; pan: number; punchIn: boolean };
  grade: Grade;
  effects: StylePlan["effects"];
  caption: CaptionStyleId;
};

const NEUTRAL: Grade = { brightness: 1, contrast: 1, saturate: 1, sepia: 0, hue: 0 };

export const NICHE_PRESETS: Record<NicheId, NichePreset> = {
  general: {
    transitions: ["fade", "slide", "zoom", "wipe"],
    transitionSeconds: 0.6,
    kenBurns: { zoom: 0.12, pan: 1.5, punchIn: false },
    grade: { ...NEUTRAL, contrast: 1.04, saturate: 1.05 },
    effects: { vignette: 0.25, grain: 0.02, lightLeak: 0, letterbox: false, tint: null },
    caption: "bold",
  },
  tech: {
    transitions: ["glitch", "zoom", "whip", "slide"],
    transitionSeconds: 0.45,
    kenBurns: { zoom: 0.1, pan: 1.2, punchIn: false },
    grade: { ...NEUTRAL, contrast: 1.1, saturate: 0.95, hue: -6 },
    effects: { vignette: 0.4, grain: 0.05, lightLeak: 0, letterbox: false, tint: "rgba(40,120,255,0.18)" },
    caption: "tech",
  },
  travel: {
    transitions: ["fade", "zoom", "slide", "iris"],
    transitionSeconds: 0.85,
    kenBurns: { zoom: 0.16, pan: 2, punchIn: false },
    grade: { ...NEUTRAL, contrast: 1.06, saturate: 1.18, sepia: 0.06 },
    effects: { vignette: 0.3, grain: 0.03, lightLeak: 0.55, letterbox: false, tint: "rgba(255,170,90,0.12)" },
    caption: "bold",
  },
  business: {
    transitions: ["push", "slide", "wipe", "fade"],
    transitionSeconds: 0.5,
    kenBurns: { zoom: 0.07, pan: 0.8, punchIn: false },
    grade: { ...NEUTRAL, contrast: 1.04, saturate: 0.98 },
    effects: { vignette: 0.15, grain: 0, lightLeak: 0, letterbox: false, tint: null },
    caption: "clean",
  },
  fitness: {
    transitions: ["whip", "flash", "zoom", "push"],
    transitionSeconds: 0.3,
    kenBurns: { zoom: 0.14, pan: 1.2, punchIn: true },
    grade: { ...NEUTRAL, contrast: 1.2, saturate: 1.1, brightness: 0.98 },
    effects: { vignette: 0.55, grain: 0.05, lightLeak: 0, letterbox: false, tint: "rgba(255,60,40,0.1)" },
    caption: "impact",
  },
  food: {
    transitions: ["fade", "zoom", "iris", "slide"],
    transitionSeconds: 0.6,
    kenBurns: { zoom: 0.13, pan: 1.2, punchIn: false },
    grade: { ...NEUTRAL, contrast: 1.05, saturate: 1.22, sepia: 0.1, brightness: 1.03 },
    effects: { vignette: 0.25, grain: 0.02, lightLeak: 0.35, letterbox: false, tint: "rgba(255,150,60,0.16)" },
    caption: "warm",
  },
  gaming: {
    transitions: ["glitch", "whip", "flash", "flip"],
    transitionSeconds: 0.35,
    kenBurns: { zoom: 0.13, pan: 1.5, punchIn: true },
    grade: { ...NEUTRAL, contrast: 1.12, saturate: 1.3 },
    effects: { vignette: 0.35, grain: 0.03, lightLeak: 0, letterbox: false, tint: "rgba(170,60,255,0.14)" },
    caption: "playful",
  },
  documentary: {
    transitions: ["dip", "fade", "fade", "wipe"],
    transitionSeconds: 1.0,
    kenBurns: { zoom: 0.09, pan: 1, punchIn: false },
    grade: { ...NEUTRAL, contrast: 1.08, saturate: 0.72, sepia: 0.18, brightness: 0.97 },
    effects: { vignette: 0.6, grain: 0.08, lightLeak: 0, letterbox: true, tint: null },
    caption: "cinematic",
  },
};

/** "Bold · Montserrat Black" etc. */
export const CAPTION_STYLE_LABELS = Object.fromEntries(
  CAPTION_STYLES.map((id) => [id, `${CAPTION_LOOKS[id].label} · ${FONTS[CAPTION_LOOKS[id].font].label}`]),
) as Record<CaptionStyleId, string>;

/** Small, stable 32-bit hash so "random" choices repeat between preview and render. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Stats that leave the niche grade untouched (used when only the aspect ratio is known). */
export const NEUTRAL_IMAGE_STATS: Omit<ImageStats, "aspect"> = { luma: 0.46, saturation: 0.3, warmth: 0 };

/**
 * Per-image grade: the niche's look, nudged so dark photos are lifted,
 * washed-out ones get a little colour back and over-saturated ones are
 * calmed, which keeps a mixed set of photos looking like one video.
 */
function gradeFor(base: Grade, stats: ImageStats | null): string {
  let { brightness, saturate } = base;
  const { contrast, sepia, hue } = base;
  if (stats) {
    brightness *= clamp(1 + (0.46 - stats.luma) * 0.45, 0.92, 1.2);
    if (stats.saturation < 0.18) saturate *= 1.15;
    else if (stats.saturation > 0.55) saturate *= 0.9;
  }
  const f = (n: number) => Math.round(n * 1000) / 1000;
  return [
    `brightness(${f(brightness)})`,
    `contrast(${f(contrast)})`,
    `saturate(${f(saturate)})`,
    sepia ? `sepia(${f(sepia)})` : "",
    hue ? `hue-rotate(${f(hue)}deg)` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export type StyleInputs = {
  niche: NicheId;
  caption?: CaptionStyleId | null;
  timing: Pick<Timing, "wpm" | "scenes" | "cues">;
  /** One entry per image, in order; null when stats are unknown. */
  imageStats: (ImageStats | null)[];
};

export function planStyle({ niche, caption, timing, imageStats }: StyleInputs): StylePlan {
  const preset = NICHE_PRESETS[niche];
  const seed = hashString(timing.cues.map((c) => c.words.map((w) => w.text).join(" ")).join("|") + niche);
  const rand = mulberry32(seed);

  // Pace: fast talkers get snappier cuts, slow narration gets longer ones.
  const pace = clamp(150 / Math.max(60, timing.wpm || 150), 0.7, 1.3);
  const shortestScene = Math.min(...timing.scenes.map((s) => s.end - s.start));
  let seconds = preset.transitionSeconds * pace;
  // Never let a transition eat more than 40% of the shortest image's time.
  seconds = Math.min(seconds, shortestScene * 0.4);
  const transitionFrames = Math.max(6, Math.round((seconds * FPS) / 2) * 2);

  // Rotate through the niche's transitions without repeating back-to-back;
  // the first choice is weighted towards the niche's signature transition.
  const cuts = Math.max(0, timing.scenes.length - 1);
  const pool = preset.transitions;
  const transitions: TransitionKind[] = [];
  for (let i = 0; i < cuts; i++) {
    let pick: TransitionKind;
    do {
      const r = rand();
      pick = r < 0.4 ? pool[0] : pool[1 + Math.floor(rand() * (pool.length - 1))];
    } while (pool.some((p) => p !== pool[0]) && pick === transitions[i - 1]);
    transitions.push(pick);
  }

  const scenes: SceneLook[] = timing.scenes.map((_, i) => {
    const stats = imageStats[i] ?? null;
    return {
      fit: stats && stats.aspect < 1.3 ? "blur-fill" : "cover",
      filter: gradeFor(preset.grade, stats),
    };
  });

  return {
    niche,
    caption: caption ?? preset.caption,
    transitionFrames,
    transitions,
    kenBurns: { ...preset.kenBurns, zoom: preset.kenBurns.zoom * clamp(1 / pace, 0.85, 1.2) },
    effects: preset.effects,
    scenes,
  };
}

/** Combine timing, style and media URLs into the composition's props. */
export function buildVideoProps(
  timing: Timing,
  plan: StylePlan,
  audioSrc: string,
  imageSrcs: string[],
  music: BackgroundMusic | null = null,
): MainVideoProps {
  const { scenes: looks, ...style } = plan;
  return {
    music: music ? { src: music.src, volume: clamp(music.volume, 0, 1) } : null,
    audioSrc,
    audioOffset: timing.audioOffset,
    durationInSeconds: timing.durationInSeconds,
    cues: timing.cues,
    scenes: timing.scenes.map((s, i) => ({ ...s, ...looks[i], src: imageSrcs[i] })),
    style,
  };
}
