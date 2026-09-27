import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { VideoEffectId } from "../lib/types";
import { effectLook } from "../lib/videoEffects";
import { Grain, LightLeak, Vignette } from "./effects";

// The whole-video looks from lib/videoEffects.ts. EffectLayer grades the
// picture (never the captions); EffectOverlays adds the texture on top.

/** Colour grades CSS filters can't express, referenced as `url(#ve-…)`. */
const SVG_FILTERS: Partial<Record<VideoEffectId, React.ReactNode>> = {
  // Split-tone: red is pulled down in the shadows and up in the highlights,
  // blue the other way round, giving teal shadows and warm highlights.
  cinematic: (
    <filter id="ve-cinematic" colorInterpolationFilters="sRGB">
      <feComponentTransfer>
        <feFuncR type="table" tableValues="0 0.2 0.5 0.8 1" />
        <feFuncG type="table" tableValues="0 0.24 0.5 0.76 0.98" />
        <feFuncB type="table" tableValues="0.04 0.32 0.52 0.7 0.9" />
      </feComponentTransfer>
    </filter>
  ),
  // Bloom: a blurred copy keeping only the bright parts, screened back over the picture.
  dreamy: (
    <filter id="ve-dreamy" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="blur" />
      <feComponentTransfer in="blur" result="glow">
        <feFuncR type="linear" slope="1.2" intercept="-0.5" />
        <feFuncG type="linear" slope="1.2" intercept="-0.5" />
        <feFuncB type="linear" slope="1.2" intercept="-0.5" />
      </feComponentTransfer>
      <feBlend in="SourceGraphic" in2="glow" mode="screen" />
    </filter>
  ),
  // Chromatic aberration: red shifted left, blue right, recombined.
  vhs: (
    <filter id="ve-vhs" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
      <feOffset in="r" dx="-5" result="red" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
      <feOffset in="b" dx="5" result="blue" />
      <feBlend in="red" in2="green" mode="screen" result="rg" />
      <feBlend in="rg" in2="blue" mode="screen" />
    </filter>
  ),
};

/** Wraps the picture (all scenes and transitions) in the effect's grade and motion. */
export const EffectLayer: React.FC<{ effect: VideoEffectId; children: React.ReactNode }> = ({ effect, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const look = effectLook(effect);
  if (!look) return <>{children}</>;

  let filter = look.filter;
  let transform: string | undefined;
  if (effect === "vintage") {
    // Projector flicker and gate weave: a new brightness and a tiny offset every frame.
    const flicker = 1 + (random(`flicker-${frame}`) - 0.5) * 0.08;
    filter += ` brightness(${flicker.toFixed(3)})`;
    const x = (random(`weave-x-${frame}`) - 0.5) * 3;
    const y = (random(`weave-y-${frame}`) - 0.5) * 2;
    transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(1.012)`;
  } else if (effect === "vhs") {
    // Tracking glitch: now and then the picture jolts sideways for a few frames.
    const period = Math.round(fps * 2.7);
    const cycle = Math.floor(frame / period);
    if (frame % period < 3 && random(`vhs-jolt-${cycle}`) < 0.6) {
      transform = `translateX(${((random(`vhs-x-${frame}`) - 0.5) * 16).toFixed(1)}px)`;
    }
  }

  return (
    <>
      {SVG_FILTERS[effect] ? (
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
          <defs>{SVG_FILTERS[effect]}</defs>
        </svg>
      ) : null}
      <AbsoluteFill style={{ filter, transform }}>{children}</AbsoluteFill>
    </>
  );
};

/** Texture over the picture, below the captions. */
export const EffectOverlays: React.FC<{ effect: VideoEffectId; cutFrames: number[] }> = ({ effect, cutFrames }) => {
  const look = effectLook(effect);
  if (!look) return null;
  return (
    <>
      {effect === "vintage" ? (
        <AbsoluteFill style={{ backgroundColor: "rgba(255,176,96,0.16)", mixBlendMode: "soft-light" }} />
      ) : null}
      {effect === "dreamy" ? <LightLeak strength={0.45} cutFrames={cutFrames} /> : null}
      {effect === "vhs" ? <Scanlines /> : null}
      <Vignette strength={look.vignette} />
      <Grain amount={look.grain} />
      {effect === "vintage" ? <Dust /> : null}
      {effect === "vhs" ? <TrackingBand /> : null}
    </>
  );
};

/** Specks of dust and the odd vertical scratch, different on every frame. */
const Dust: React.FC = () => {
  const frame = useCurrentFrame();
  const specks = Array.from({ length: 6 }, (_, i) => {
    const r = (k: string) => random(`dust-${k}-${frame}-${i}`);
    return r("on") < 0.45 ? { x: r("x") * 100, y: r("y") * 100, size: 2 + r("s") * 5, alpha: 0.35 + r("a") * 0.5 } : null;
  });
  const step = Math.floor(frame / 3);
  const scratch = random(`scratch-${step}`) < 0.3 ? random(`scratch-x-${step}`) * 100 : null;
  return (
    <AbsoluteFill>
      {specks.map((s, i) =>
        s ? (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size * 0.8,
              borderRadius: "50%",
              background: `rgba(20,14,8,${s.alpha.toFixed(2)})`,
            }}
          />
        ) : null,
      )}
      {scratch !== null ? (
        <div
          style={{ position: "absolute", left: `${scratch}%`, top: 0, bottom: 0, width: 2, background: "rgba(255,244,222,0.3)" }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const Scanlines: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.26) 3px, rgba(0,0,0,0.26) 4px)",
    }}
  />
);

/** A faint band of tape noise rolling slowly down the frame. */
const TrackingBand: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const period = fps * 6;
  const top = ((frame % period) / period) * 120 - 10;
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${top}%`,
          height: "7%",
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.16) 45%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0))",
        }}
      />
    </AbsoluteFill>
  );
};
