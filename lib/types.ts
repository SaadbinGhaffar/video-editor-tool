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

/** A regular (landscape) YouTube video or a vertical YouTube Short. */
export const VIDEO_FORMATS = ["landscape", "shorts"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];
export const FORMAT_SIZE: Record<VideoFormat, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  shorts: { width: 1080, height: 1920 },
};
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

export const CAPTION_STYLES = ["bold", "classic", "clean", "impact", "tech", "cinematic", "playful", "warm"] as const;
export type CaptionStyleId = (typeof CAPTION_STYLES)[number];

/** Whole-video looks the user can put over any niche style ("none" keeps the niche's own finish). */
export const VIDEO_EFFECTS = ["none", "cinematic", "vintage", "noir", "dreamy", "vhs"] as const;
export type VideoEffectId = (typeof VIDEO_EFFECTS)[number];

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
  format: VideoFormat;
  /** When not "none", replaces the niche's grade and finishing effects for the whole video. */
  effect: VideoEffectId;
  /** Length of every image-to-image transition, in frames (even). */
  transitionFrames: number;
  /** One per cut between shots (photos and animated segments). */
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
  /** One per uploaded image, in upload order. */
  scenes: SceneLook[];
};

// ---------------------------------------------------------------------------
// Animated segments
// ---------------------------------------------------------------------------

/** A line of an animated list, revealed when the narration reaches it (`at`, seconds). */
export type AnimItem = { text: string; at: number };

/**
 * One moment inside an animated segment, shown from `start` to `end`
 * (seconds, on the video's timeline) over the user's own photos, graded and
 * moving. "words" is kinetic typography of the narration itself.
 */
export type AnimBeat = { start: number; end: number } & (
  /** The narration's words slamming in as they're spoken (replaces the captions meanwhile). */
  | { kind: "words"; emphasis: string[] }
  /** A chapter card. */
  | { kind: "title"; title: string; subtitle: string | null }
  /** Numbered points appearing as they're said. */
  | { kind: "bullets"; title: string | null; items: AnimItem[] }
  /** Stages along a glowing line, lighting up as they're said. */
  | { kind: "steps"; title: string | null; items: AnimItem[] }
  /** A giant counter (a thin ring for percentages). */
  | { kind: "stat"; value: number; decimals: number; prefix: string; suffix: string; label: string }
  /** "Day 47": a calendar grid with days crossed off one by one. */
  | { kind: "streak"; total: number; marked: number; label: string }
  /** "7 in 10": a grid of figures lighting up. */
  | { kind: "pictogram"; filled: number; total: number; label: string }
  | { kind: "bars"; title: string | null; unit: string; bars: { label: string; value: number }[] }
  /** A line chart that draws itself, for values over time. */
  | { kind: "line"; title: string | null; unit: string; points: { label: string; value: number }[] }
  /** Split screen: two photos side by side. */
  | { kind: "compare"; left: { title: string; points: string[] }; right: { title: string; points: string[] } }
);
export type AnimBeatKind = AnimBeat["kind"];

/** A chunk of the video drawn as animation instead of photos. */
export type AnimatedSegment = { start: number; end: number; beats: AnimBeat[] };

export type AnimationPlan = {
  segments: AnimatedSegment[];
  /** "llm" when an AI model designed the beats; "basic" is the offline fallback. */
  source: "llm" | "basic";
};

/**
 * What the user asked for: animated chunks on/off, how much of the video they
 * cover (0–1), and facts and figures they can show.
 */
export type AnimationRequest = { enabled: boolean; share: number; data: string };

/** Everything the video needs besides the media files themselves. */
export type Timing = {
  durationInSeconds: number;
  /** Seconds of leading silence skipped from the audio file. */
  audioOffset: number;
  cues: CaptionCue[];
  /**
   * Photo slices of the timeline. `image` is the uploaded image shown (0-based);
   * when absent it's the scene's own index. With animated segments, an image
   * can appear more than once.
   */
  scenes: { start: number; end: number; image?: number }[];
  /** Animated chunks between the photo scenes, or null when the video is photos only. */
  animation: AnimationPlan | null;
  /** Number of transcript words that were timed. */
  words: number;
  /** Speaking rate, words per minute. */
  wpm: number;
  detected: NicheDetection;
  /** Which speech-to-text produced the timing. */
  provider: string;
};

/** One image's slice of the timeline. Times in seconds. */
export type ImageScene = SceneLook & {
  kind: "image";
  src: string;
  start: number;
  end: number;
};

/** An animated chunk of the timeline. Times in seconds. */
export type AnimatedScene = AnimatedSegment & {
  kind: "animated";
  /** The uploaded photos (with their grade), used as the moving backgrounds. */
  images: { src: string; filter: string }[];
};

/** One shot of the video, in order: a photo or an animated segment. */
export type Scene = ImageScene | AnimatedScene;

/** Props passed to the Remotion composition. */
export type MainVideoProps = {
  audioSrc: string;
  audioOffset: number;
  durationInSeconds: number;
  scenes: Scene[];
  cues: CaptionCue[];
  style: Omit<StylePlan, "scenes">;
  /** Optional background music, looped under the narration for the whole video. */
  music: BackgroundMusic | null;
};

export type BackgroundMusic = {
  src: string;
  /** Level while nobody is speaking, 0–1. It dips automatically under the narration. */
  volume: number;
};

export const DEFAULT_MUSIC_VOLUME = 0.3;

/** YouTube metadata written from the transcript once a video is rendered. */
export type SeoPack = {
  title: string;
  /** Plain text, paragraphs separated by blank lines, ending with a hashtag line. */
  description: string;
  tags: string[];
  /** "llm" when an AI model wrote it; "basic" is the offline fallback. */
  source: "llm" | "basic";
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
  | {
      /** Vercel: the render continues in a sandbox; poll /api/render-progress with these ids. */
      type: "detached";
      sandboxId: string;
      cmdId: string;
      durationInSeconds: number;
      words: number;
      cues: number;
      niche: NicheId;
      provider: string;
    }
  | { type: "error"; message: string };

/** GET /api/render-progress response. */
export type RenderStatus =
  | { state: "running"; message: string; progress: number }
  | { state: "done"; url: string; downloadUrl: string; size: number }
  | { state: "error"; message: string };
