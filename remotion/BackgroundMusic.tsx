import { useMemo } from "react";
import { Audio, interpolate, useVideoConfig } from "remotion";
import type { BackgroundMusic as Music, CaptionCue } from "../lib/types";

/** How far the music dips under the voice (fraction of its normal level). */
const DUCK_TO = 0.4;
/** Seconds to ramp down before speech and back up after it. */
const DUCK_RAMP = 0.35;
/** Gaps in speech shorter than this don't bring the music back up. */
const SPEECH_GAP = 0.8;

/**
 * Music bed for the whole video: loops if shorter than the narration, fades
 * in at the start and out at the end, and dips automatically while words are
 * being spoken so the voice stays clear.
 */
export const BackgroundMusic: React.FC<{ music: Music; cues: CaptionCue[]; resolve: (src: string) => string }> = ({
  music,
  cues,
  resolve,
}) => {
  const { fps, durationInFrames } = useVideoConfig();

  // Merge word timings into continuous stretches of speech.
  const speech = useMemo(() => {
    const spans: [number, number][] = [];
    for (const w of cues.flatMap((c) => c.words)) {
      const last = spans[spans.length - 1];
      if (last && w.start - last[1] < SPEECH_GAP) last[1] = Math.max(last[1], w.end);
      else spans.push([w.start, w.end]);
    }
    return spans;
  }, [cues]);

  const total = durationInFrames / fps;
  const volume = (frame: number) => {
    const t = frame / fps;
    // 0 = full level, 1 = fully ducked, ramping smoothly around each stretch of speech.
    let duck = 0;
    for (const [s, e] of speech) {
      if (t < s - DUCK_RAMP) break;
      duck = Math.max(
        duck,
        interpolate(t, [s - DUCK_RAMP, s, e, e + DUCK_RAMP], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      );
    }
    const fade = interpolate(t, [0, 1, Math.max(1.01, total - 2), total], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return music.volume * (1 - duck * (1 - DUCK_TO)) * fade;
  };

  // "extend": the volume curve runs across all loops instead of restarting each loop.
  return <Audio src={resolve(music.src)} loop loopVolumeCurveBehavior="extend" volume={volume} />;
};
