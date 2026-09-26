import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { StylePlan } from "../lib/types";

export const LETTERBOX_HEIGHT = 64;

/** Frame-wide finishing layers chosen by the niche style. */
export const Effects: React.FC<{ effects: StylePlan["effects"]; cutFrames: number[] }> = ({ effects, cutFrames }) => (
  <>
    {effects.tint ? <AbsoluteFill style={{ backgroundColor: effects.tint, mixBlendMode: "soft-light" }} /> : null}
    {effects.lightLeak > 0 ? <LightLeak strength={effects.lightLeak} cutFrames={cutFrames} /> : null}
    {effects.vignette > 0 ? (
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,${effects.vignette}) 100%)`,
        }}
      />
    ) : null}
    {effects.grain > 0 ? <Grain amount={effects.grain} /> : null}
  </>
);

/** Cinematic bars; drawn above the image but below captions. */
export const Letterbox: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: LETTERBOX_HEIGHT, background: "black" }} />
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: LETTERBOX_HEIGHT, background: "black" }} />
  </AbsoluteFill>
);

let noiseTile: string | null = null;

/** A 256×256 grey-noise tile, generated once with seeded randomness. */
function getNoiseTile(): string {
  if (noiseTile) return noiseTile;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(random(`grain-${i}`) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = canvas.toDataURL("image/png");
  return noiseTile;
}

/** Film grain: a noise tile jumping to a new random offset every other frame. */
const Grain: React.FC<{ amount: number }> = ({ amount }) => {
  const frame = useCurrentFrame();
  const step = Math.floor(frame / 2);
  const x = Math.floor(random(`gx-${step}`) * 256);
  const y = Math.floor(random(`gy-${step}`) * 256);
  // The (large) data URL lives in a stylesheet that never changes, so each
  // frame only updates the background offset.
  return (
    <>
      <style>{`.remotion-grain{background-image:url(${getNoiseTile()});background-size:384px 384px}`}</style>
      <AbsoluteFill
        className="remotion-grain"
        style={{ opacity: Math.min(1, amount * 2.5), mixBlendMode: "overlay", backgroundPosition: `${x}px ${y}px` }}
      />
    </>
  );
};

/**
 * Warm light leaks drifting across the frame, flaring up around each cut
 * (a common travel/lifestyle look).
 */
const LightLeak: React.FC<{ strength: number; cutFrames: number[] }> = ({ strength, cutFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nearest = cutFrames.reduce((d, c) => Math.min(d, Math.abs(frame - c)), Infinity);
  const flare = interpolate(nearest, [0, fps * 0.6], [1, 0], { extrapolateRight: "clamp" });
  const base = 0.18 + 0.12 * Math.sin(frame / (fps * 2.3));
  const opacity = Math.min(1, (base + flare * 0.7) * strength);
  const x = 20 + 60 * ((Math.sin(frame / (fps * 3.1)) + 1) / 2);
  const y = 15 + 30 * ((Math.cos(frame / (fps * 4.3)) + 1) / 2);
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        opacity,
        background: `radial-gradient(circle at ${x}% ${y}%, rgba(255,170,80,0.9) 0%, rgba(255,110,60,0.45) 22%, rgba(255,80,120,0) 55%),
          radial-gradient(circle at ${100 - x}% ${100 - y / 2}%, rgba(255,210,150,0.55) 0%, rgba(255,210,150,0) 40%)`,
      }}
    />
  );
};
