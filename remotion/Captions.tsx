import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionCue, CaptionStyleId } from "../lib/types";
import { fontFamily, type FontKey } from "./fonts";

type Look = {
  font: FontKey;
  weight: number;
  /** px at 1080p. Every look keeps glyphs at roughly 7–9% of frame height so they read on a phone. */
  size: number;
  uppercase: boolean;
  color: string;
  highlight: string;
  /** "color": active word changes colour. "box": active word gets a coloured pill. */
  mode: "color" | "box";
  boxText?: string;
  stroke: number;
  /** Dark rounded panel behind the whole cue. */
  panel: boolean;
  enter: "pop" | "rise" | "punch" | "fade" | "bounce";
  letterSpacing?: string;
};

const LOOKS: Record<CaptionStyleId, Look> = {
  bold: { font: "montserrat", weight: 800, size: 112, uppercase: false, color: "#fff", highlight: "#FFD60A", mode: "color", stroke: 14, panel: false, enter: "pop" },
  clean: { font: "inter", weight: 800, size: 100, uppercase: false, color: "#fff", highlight: "#2563EB", mode: "box", boxText: "#fff", stroke: 0, panel: true, enter: "rise" },
  impact: { font: "bebas", weight: 400, size: 150, uppercase: true, color: "#fff", highlight: "#FF3B30", mode: "color", stroke: 12, panel: false, enter: "punch", letterSpacing: "0.02em" },
  tech: { font: "spaceGrotesk", weight: 700, size: 106, uppercase: false, color: "#fff", highlight: "#22D3EE", mode: "color", stroke: 12, panel: false, enter: "rise" },
  cinematic: { font: "merriweather", weight: 900, size: 92, uppercase: false, color: "#F5F1E8", highlight: "#F2C14E", mode: "color", stroke: 10, panel: false, enter: "fade" },
  playful: { font: "bangers", weight: 400, size: 132, uppercase: true, color: "#fff", highlight: "#39FF6A", mode: "box", boxText: "#111", stroke: 12, panel: false, enter: "bounce", letterSpacing: "0.03em" },
  warm: { font: "poppins", weight: 800, size: 106, uppercase: false, color: "#fff", highlight: "#FF9F43", mode: "color", stroke: 13, panel: false, enter: "pop" },
};

export const Captions: React.FC<{ cues: CaptionCue[]; styleId: CaptionStyleId; bottom: number }> = ({
  cues,
  styleId,
  bottom,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.start && t < c.end);
  const look = LOOKS[styleId] ?? LOOKS.bold;

  return (
    <AbsoluteFill>
      {/* Soft darkening behind the lower third so light text holds up on bright photos. */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 28%, rgba(0,0,0,0) 45%)",
        }}
      />
      {cue ? <Cue key={cue.start} cue={cue} t={t} frame={frame} fps={fps} look={look} bottom={bottom} /> : null}
    </AbsoluteFill>
  );
};

const Cue: React.FC<{ cue: CaptionCue; t: number; frame: number; fps: number; look: Look; bottom: number }> = ({
  cue,
  t,
  frame,
  fps,
  look,
  bottom,
}) => {
  const local = frame - Math.round(cue.start * fps);
  const enter = entrance(look.enter, local, fps);

  // A word stays highlighted from its start until the next word starts.
  let active = -1;
  cue.words.forEach((w, i) => {
    if (t >= w.start) active = i;
  });
  const activeStart = active >= 0 ? Math.round(cue.words[active].start * fps) : 0;
  const wordPop = spring({ frame: frame - activeStart, fps, config: { damping: 12, stiffness: 260, mass: 0.5 } });

  const stroke = look.stroke
    ? { WebkitTextStroke: `${look.stroke}px black`, paintOrder: "stroke fill" as const }
    : { textShadow: "0 4px 14px rgba(0,0,0,0.55)" };

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        // Title-safe side margins; bottom margin keeps text clear of YouTube's
        // progress bar and controls (and of the letterbox bar when present).
        padding: `0 140px ${bottom}px`,
      }}
    >
      <div
        style={{
          fontFamily: `${fontFamily(look.font)}, "Arial Black", Arial, sans-serif`,
          fontWeight: look.weight,
          fontSize: look.size,
          lineHeight: 1.12,
          textAlign: "center",
          color: look.color,
          maxWidth: 1640,
          textTransform: look.uppercase ? "uppercase" : "none",
          letterSpacing: look.letterSpacing,
          opacity: enter.opacity,
          transform: `translateY(${enter.y}px) scale(${enter.scale}) rotate(${enter.rotate}deg)`,
          textShadow: look.stroke ? "0 6px 18px rgba(0,0,0,0.6)" : undefined,
          ...(look.panel
            ? { background: "rgba(10,12,20,0.72)", borderRadius: 22, padding: "10px 26px 16px" }
            : {}),
        }}
      >
        {cue.words.map((w, i) => {
          const isActive = i === active;
          const boxed = isActive && look.mode === "box";
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                margin: "0 0.18em",
                color: isActive ? (boxed ? (look.boxText ?? "#fff") : look.highlight) : look.color,
                transform: isActive ? `scale(${interpolate(wordPop, [0, 1], [1, 1.05])})` : "none",
                ...(boxed
                  ? { background: look.highlight, borderRadius: "0.18em", padding: "0 0.14em", boxShadow: "0 6px 16px rgba(0,0,0,0.35)" }
                  : stroke),
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

function entrance(kind: Look["enter"], local: number, fps: number) {
  const s = (damping: number, stiffness: number) =>
    spring({ frame: local, fps, config: { damping, stiffness, mass: 0.6 } });
  const fadeIn = interpolate(local, [0, 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  switch (kind) {
    case "pop": {
      const p = s(14, 220);
      return { opacity: fadeIn, scale: interpolate(p, [0, 1], [0.86, 1]), y: 0, rotate: 0 };
    }
    case "rise": {
      const p = s(18, 180);
      return { opacity: fadeIn, scale: 1, y: interpolate(p, [0, 1], [28, 0]), rotate: 0 };
    }
    case "punch": {
      const p = s(16, 320);
      return { opacity: fadeIn, scale: interpolate(p, [0, 1], [1.28, 1]), y: 0, rotate: 0 };
    }
    case "fade": {
      const o = interpolate(local, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      return { opacity: o, scale: 1, y: 0, rotate: 0 };
    }
    case "bounce": {
      const p = s(8, 200);
      return { opacity: fadeIn, scale: interpolate(p, [0, 1], [0.6, 1]), y: 0, rotate: interpolate(p, [0, 1], [-5, 0]) };
    }
  }
}
