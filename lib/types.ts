/** A single word with timing in seconds. */
export type TimedWord = {
  text: string;
  start: number;
  end: number;
};

/** A short group of words shown on screen together. Times in seconds. */
export type CaptionCue = {
  start: number;
  end: number;
  words: TimedWord[];
};

export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const FPS = 30;
export const MIN_IMAGES = 2;
export const MAX_IMAGES = 10;
/** Shortest slice of the timeline one image may get, in seconds. */
export const MIN_SCENE_SECONDS = 1.2;

// ---------------------------------------------------------------------------
// Niche & style
// ---------------------------------------------------------------------------

export const NICHES = ["general", "tech", "travel", "business", "fitness", "food", "gaming", "documentary"] as const;
export type NicheId = (typeof NICHES)[number];

export const CAPTION_STYLES = ["bold", "clean", "impact", "tech", "cinematic", "playful", "warm"] as const;
export type CaptionStyleId = (typeof CAPTION_STYLES)[number];

export type TransitionKind =
  | "fade"
  | "slide"
  | "wipe"
  | "flip"
  | "iris"
  | "push"
  | "zoom"
  | "whip"
  | "glitch"
  | "flash"
  | "dip";

export type NicheDetection = {
  niche: NicheId;
  /** 0–1: how clearly the transcript points at this niche. */
  confidence: number;
  /** Words (or a short reason) that led to the choice, for display. */
  signals: string[];
  source: "keywords" | "llm";
};

/** Colour stats of one uploaded image, measured in the browser. */
export type ImageStats = {
  /** Mean luminance, 0–1. */
  luma: number;
  /** Mean saturation, 0–1. */
  saturation: number;
  /** Red-vs-blue balance, -1 (cool) to 1 (warm). */
  warmth: number;
  /** width / height */
  aspect: number;
};

/** How one image is drawn for its slice of the timeline. */
export type SceneLook = {
  /** "blur-fill": portrait/square images shown whole over a blurred copy instead of cropped. */
  fit: "cover" | "blur-fill";
  /** CSS filter (colour grade) for this image. */
  filter: string;
};

export type StylePlan = {
  niche: NicheId;
  caption: CaptionStyleId;
  /** Length of every image-to-image transition, in frames (even). */
  transitionFrames: number;
  /** One per cut (images - 1). */
  transitions: TransitionKind[];
  kenBurns: { zoom: number; pan: number; punchIn: boolean };
  effects: {
    vignette: number;
    grain: number;
    lightLeak: number;
    letterbox: boolean;
    /** Colour laid over the whole frame with soft-light blending, or null. */
    tint: string | null;
  };
  scenes: SceneLook[];
};

/** Everything the video needs besides the media files themselves. */
export type Timing = {
  durationInSeconds: number;
  /** Seconds of leading silence skipped from the audio file. */
  audioOffset: number;
  cues: CaptionCue[];
  scenes: { start: number; end: number }[];
  /** Number of transcript words that were timed. */
  words: number;
  /** Speaking rate, words per minute. */
  wpm: number;
  detected: NicheDetection;
  /** Which speech-to-text produced the timing. */
  provider: string;
};

/** One image's slice of the timeline. Times in seconds. */
export type Scene = SceneLook & {
  src: string;
  start: number;
  end: number;
};

/** Props passed to the Remotion composition. */
export type MainVideoProps = {
  audioSrc: string;
  audioOffset: number;
  durationInSeconds: number;
  scenes: Scene[];
  cues: CaptionCue[];
  style: Omit<StylePlan, "scenes">;
};

export type PipelineStage = "upload" | "transcribing" | "bundling" | "queued" | "rendering";

/** Newline-delimited JSON events streamed by POST /api/generate. */
export type GenerateEvent =
  | { type: "progress"; stage: PipelineStage; message: string; progress?: number }
  | {
      type: "done";
      url: string;
      downloadUrl: string;
      durationInSeconds: number;
      words: number;
      cues: number;
      niche: NicheId;
      provider: string;
    }
  | { type: "error"; message: string };
