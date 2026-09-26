import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import { AbsoluteFill, interpolate, random } from "remotion";

// Pure-CSS transitions (no WebGL), so they look identical in the in-browser
// preview and in the server render.

type Empty = Record<string, never>;
const clamp01 = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Push "through" the cut: outgoing zooms in and blurs away, incoming settles from a zoom. */
const ZoomThrough: React.FC<TransitionPresentationComponentProps<Empty>> = ({
  children,
  presentationDirection,
  presentationProgress: p,
}) => {
  const entering = presentationDirection === "entering";
  const style: React.CSSProperties = entering
    ? {
        opacity: interpolate(p, [0.25, 0.7], [0, 1], clamp01),
        transform: `scale(${interpolate(p, [0, 1], [1.35, 1])})`,
        filter: `blur(${interpolate(p, [0.3, 1], [10, 0], clamp01)}px)`,
      }
    : {
        transform: `scale(${interpolate(p, [0, 1], [1, 1.5])})`,
        filter: `blur(${interpolate(p, [0, 0.6], [0, 12], clamp01)}px)`,
      };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

/** Fast camera whip: both shots slide with heavy motion blur in the middle. */
const Whip: React.FC<TransitionPresentationComponentProps<{ dir: 1 | -1 }>> = ({
  children,
  presentationDirection,
  presentationProgress: p,
  passedProps,
}) => {
  const entering = presentationDirection === "entering";
  const x = entering ? interpolate(p, [0, 1], [100, 0]) : interpolate(p, [0, 1], [0, -100]);
  const blur = interpolate(p, [0, 0.5, 1], [0, 18, 0]);
  return (
    <AbsoluteFill style={{ transform: `translateX(${x * passedProps.dir}%)`, filter: `blur(${blur}px)` }}>
      {children}
    </AbsoluteFill>
  );
};

/** Cut through a flash of colour (white for sport, black = dip for story). */
const FlashCut: React.FC<TransitionPresentationComponentProps<{ color: string; soft: boolean }>> = ({
  children,
  presentationDirection,
  presentationProgress: p,
  passedProps,
}) => {
  if (presentationDirection === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  // The entering side sits on top: it hides itself before the midpoint and
  // draws the colour overlay across both halves.
  const flash = passedProps.soft
    ? interpolate(p, [0, 0.45, 0.55, 1], [0, 1, 1, 0], clamp01)
    : interpolate(p, [0, 0.5, 1], [0, 1, 0], clamp01);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: p >= 0.5 ? 1 : 0 }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: passedProps.color, opacity: flash }} />
    </AbsoluteFill>
  );
};

/**
 * Digital glitch: the frame splits into offset red and cyan copies with a
 * couple of jittering slices around the cut. Channels are isolated by
 * multiplying with a solid colour and recombined with screen blending (which
 * is additive for disjoint channels), much cheaper than SVG filters.
 */
const Glitch: React.FC<TransitionPresentationComponentProps<{ seed: number }>> = ({
  children,
  presentationDirection,
  presentationProgress: p,
  passedProps,
}) => {
  const entering = presentationDirection === "entering";
  const visible = entering ? p >= 0.5 : p < 0.5;
  if (!visible) return <AbsoluteFill style={{ opacity: 0 }}>{children}</AbsoluteFill>;

  const strength = interpolate(p, [0, 0.5, 1], [0, 1, 0]);
  const step = Math.floor(p * 12);
  const r = (k: number) => random(`${passedProps.seed}-${step}-${k}`) * 2 - 1;
  const split = 26 * strength;
  const slices = [0, 1].map((k) => ({
    top: 10 + Math.abs(r(10 + k)) * 75,
    height: 4 + Math.abs(r(20 + k)) * 10,
    shift: r(30 + k) * 90 * strength,
  }));

  const channel = (color: string, dx: number, dy: number) => (
    <AbsoluteFill style={{ mixBlendMode: "screen", transform: `translate(${dx}px, ${dy}px)` }}>
      <AbsoluteFill style={{ isolation: "isolate" }}>
        {children}
        <AbsoluteFill style={{ backgroundColor: color, mixBlendMode: "multiply" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "black", isolation: "isolate" }}>
      {channel("#f00", split, r(1) * 4 * strength)}
      {channel("#0ff", -split, r(2) * 4 * strength)}
      {slices.map((s, i) => (
        <AbsoluteFill
          key={i}
          style={{
            clipPath: `inset(${s.top}% 0 ${100 - s.top - s.height}% 0)`,
            transform: `translateX(${s.shift}px)`,
          }}
        >
          {children}
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};

export const zoomThrough = (): TransitionPresentation<Empty> => ({ component: ZoomThrough, props: {} });
export const whip = (dir: 1 | -1 = 1): TransitionPresentation<{ dir: 1 | -1 }> => ({ component: Whip, props: { dir } });
export const flashCut = (color = "white"): TransitionPresentation<{ color: string; soft: boolean }> => ({
  component: FlashCut,
  props: { color, soft: false },
});
export const dipToBlack = (): TransitionPresentation<{ color: string; soft: boolean }> => ({
  component: FlashCut,
  props: { color: "black", soft: true },
});
export const glitch = (seed: number): TransitionPresentation<{ seed: number }> => ({ component: Glitch, props: { seed } });
