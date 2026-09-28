import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { SceneLook, StylePlan } from "../lib/types";

// Movement directions, cycled per image: [startX%, startY%] → [endX%, endY%],
// and whether the image zooms in (true) or out.
const MOVES: [[number, number], [number, number], boolean][] = [
  [[-1, 0], [1, -0.6], true],
  [[1, 0.6], [-1, 0], false],
  [[0, 1], [0, -1], true],
  [[-0.7, -0.7], [0.7, 0.7], false],
  [[1, -0.5], [-0.5, 0.5], true],
];

export const KenBurnsImage: React.FC<{
  src: string;
  index: number;
  durationInFrames: number;
  look: SceneLook;
  kenBurns: StylePlan["kenBurns"];
}> = ({ src, index, durationInFrames, look, kenBurns }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [[x0, y0], [x1, y1], zoomIn] = MOVES[index % MOVES.length];
  const t = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.sin),
  });

  // Base scale stays above 1 + pan so the frame edge never shows.
  const zoom = kenBurns.zoom;
  const lo = 1.04 + kenBurns.pan / 100;
  const scale0 = zoomIn ? lo : lo + zoom;
  const scale1 = zoomIn ? lo + zoom : lo;
  let scale = scale0 + (scale1 - scale0) * t;
  // Energetic niches: each image lands with a quick punch-in.
  if (kenBurns.punchIn) {
    const punch = spring({ frame, fps, config: { damping: 18, stiffness: 240, mass: 0.6 } });
    scale *= interpolate(punch, [0, 1], [1.12, 1]);
  }
  const x = (x0 + (x1 - x0) * t) * kenBurns.pan;
  const y = (y0 + (y1 - y0) * t) * kenBurns.pan;
  const transform = `translate(${x}%, ${y}%) scale(${scale})`;

  if (look.fit === "blur-fill") {
    // Portrait/square photo: show it whole over a blurred, darkened copy of itself.
    return (
      <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
        <BlurredBackdrop src={src} filter={look.filter} />
        <AbsoluteFill style={{ transform: `scale(${1 + (scale - lo) * 0.6})` }}>
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              filter: look.filter,
            }}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: look.filter,
          transform,
          transformOrigin: "center center",
        }}
      />
    </AbsoluteFill>
  );
};

const backdropCache = new Map<string, string | "css">();

/**
 * Blurred, darkened copy of the image used behind portrait photos. It's
 * blurred once into a small canvas and scaled up, instead of running a
 * full-frame 40px blur on every frame. If the image can't be read into a
 * canvas (e.g. served cross-origin without CORS), it falls back to a CSS blur.
 */
const BlurredBackdrop: React.FC<{ src: string; filter: string }> = ({ src, filter }) => {
  const { width, height } = useVideoConfig();
  const key = `${src}|${filter}|${width}x${height}`;
  const [url, setUrl] = useState(() => backdropCache.get(key) ?? null);
  const [handle] = useState(() => (backdropCache.has(key) ? null : delayRender(`Blurring backdrop for ${src}`)));

  useEffect(() => {
    if (url) return;
    const done = (out: string | "css") => {
      backdropCache.set(key, out);
      setUrl(out);
    };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        // A tenth of the frame, in its shape.
        const w = Math.round(width / 10);
        const h = Math.round(height / 10);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.filter = `${filter} blur(4px) brightness(0.6)`;
        // Cover-crop into the canvas, overdrawn a little so the blur has no edge.
        const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * 1.15;
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        done(canvas.toDataURL("image/jpeg", 0.9));
      } catch {
        done("css");
      }
    };
    img.onerror = () => done("css");
    img.src = src;
  }, [key, src, filter, url, width, height]);

  useEffect(() => {
    if (url && handle !== null) continueRender(handle);
  }, [url, handle]);

  if (url === "css") {
    return (
      <Img
        src={src}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: `${filter} blur(40px) brightness(0.6)`,
          transform: "scale(1.2)",
        }}
      />
    );
  }
  return url ? (
    <img src={url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
  ) : null;
};
