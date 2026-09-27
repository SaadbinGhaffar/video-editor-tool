import { AbsoluteFill, interpolate, Loop, OffthreadVideo, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneLook, StylePlan } from "../lib/types";

/** Slowest a short clip is played to stretch it over its slot before it starts looping. */
const MIN_PLAYBACK_RATE = 0.6;

/**
 * A video clip filling its slice of the timeline, muted under the narration.
 * A clip shorter than its slot plays in gentle slow motion (down to 0.6×) and
 * loops if that still isn't enough; a longer one is cut at the slot's end.
 */
export const SceneVideo: React.FC<{
  src: string;
  /** Clip length in seconds, or null if unknown (then it plays once at normal speed). */
  clipSeconds: number | null;
  durationInFrames: number;
  look: SceneLook;
  kenBurns: StylePlan["kenBurns"];
}> = ({ src, clipSeconds, durationInFrames, look, kenBurns }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Stay a few frames clear of the end: containers often report a little
  // more duration than the last decodable frame.
  const clipFrames = clipSeconds ? Math.max(1, Math.floor((clipSeconds - 0.1) * fps)) : Infinity;
  const rate = clipFrames >= durationInFrames ? 1 : Math.max(MIN_PLAYBACK_RATE, clipFrames / durationInFrames);
  const loopFrames = Math.max(1, Math.floor(clipFrames / rate));

  // A slow push-in (half the photos' zoom) keeps footage in step with the stills,
  // and energetic niches get the same punch-in on each cut.
  let scale = 1 + kenBurns.zoom * 0.5 * (frame / Math.max(1, durationInFrames));
  if (kenBurns.punchIn) {
    const punch = spring({ frame, fps, config: { damping: 18, stiffness: 240, mass: 0.6 } });
    scale *= interpolate(punch, [0, 1], [1.12, 1]);
  }

  const clip = (style: React.CSSProperties) => {
    const video = <OffthreadVideo src={src} muted playbackRate={rate} style={style} />;
    return loopFrames < durationInFrames ? <Loop durationInFrames={loopFrames}>{video}</Loop> : video;
  };

  if (look.fit === "blur-fill") {
    // Portrait/square clip: show it whole over a blurred, darkened copy of itself.
    return (
      <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
        {clip({
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: `${look.filter} blur(40px) brightness(0.6)`,
          transform: "scale(1.2)",
        })}
        <AbsoluteFill style={{ transform: `scale(${scale})` }}>
          {clip({ width: "100%", height: "100%", objectFit: "contain", filter: look.filter })}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      {clip({ width: "100%", height: "100%", objectFit: "cover", filter: look.filter, transform: `scale(${scale})` })}
    </AbsoluteFill>
  );
};
