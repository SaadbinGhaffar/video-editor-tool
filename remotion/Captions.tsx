import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionCue, CaptionStyleId } from "../lib/types";
import { CAPTION_LOOKS, CRISP_TEXT, FONTS, type CaptionLook } from "../lib/captionLooks";
import { fontFamily } from "./fonts";

type Look = CaptionLook;
const LOOKS = CAPTION_LOOKS;

export const Captions: React.FC<{ cues: CaptionCue[]; styleId: CaptionStyleId; bottom: number; sidePadding: number }> = ({
  cues,
  styleId,
  bottom,
  sidePadding,
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
      {cue ? (
        <Cue key={cue.start} cue={cue} t={t} frame={frame} fps={fps} look={look} bottom={bottom} side={sidePadding} />
      ) : null}
    </AbsoluteFill>
  );
};

const Cue: React.FC<{ cue: CaptionCue; t: number; frame: number; fps: number; look: Look; bottom: number; side: number }> = ({
  cue,
  t,
  frame,
  fps,
  look,
  bottom,
  side,
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
        padding: `0 ${side}px ${bottom}px`,
      }}
    >
      <div
        style={{
          fontFamily: `"${fontFamily(look.font)}", "Arial Black", Arial, sans-serif`,
          fontWeight: FONTS[look.font].weight,
          ...CRISP_TEXT,
          fontSize: look.size,
          lineHeight: 1.12,
          textAlign: "center",
          color: look.color,
          maxWidth: "100%",
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
