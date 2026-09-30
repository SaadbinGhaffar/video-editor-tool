import { useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Easing, Img, interpolate, random, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { formatNumber, kineticCards, type AnimationTheme, type KineticCard } from "../lib/animation";
import { CRISP_TEXT, FONTS, type FontKey } from "../lib/captionLooks";
import type { AnimBeat, TimedWord, VideoFormat } from "../lib/types";
import { fontFamily } from "./fonts";

// An animated chunk of the video, in the style of cinematic motivational and
// documentary channels: the user's own photos, darkened and always moving,
// under kinetic typography of the narration (words slam in as they're
// spoken), counters, streak calendars, charts and split screens, with
// particles, light streaks and hard cuts between moments.

/** Design canvases, in px, scaled into the free area of the frame. */
const FULL: Record<VideoFormat, { w: number; h: number }> = { landscape: { w: 1600, h: 820 }, shorts: { w: 920, h: 1120 } };
const UPPER: Record<VideoFormat, { w: number; h: number }> = { landscape: { w: 1620, h: 680 }, shorts: { w: 920, h: 940 } };

/** Frames either side of a cut that its effect covers. */
const CUT = 7;

type Box = { left: number; top: number; scale: number; w: number; h: number };

type Ctx = {
  theme: AnimationTheme;
  vertical: boolean;
  fps: number;
  /** Frame on the video's timeline where the current beat starts. */
  beatFrom: number;
  length: number;
  words: TimedWord[];
  uid: string;
  /** Kinetic typography uses (nearly) the whole frame; data moments stay above the captions. */
  full: Box;
  upper: Box;
  frameW: number;
  frameH: number;
  photo: { src: string; filter: string };
  photo2: { src: string; filter: string };
  /** Varies the framing of reused photos. */
  focus: number;
};

export const AnimatedSegment: React.FC<{
  beats: AnimBeat[];
  /** Frame on the video's timeline where this shot starts. */
  from: number;
  durationInFrames: number;
  theme: AnimationTheme;
  format: VideoFormat;
  /** The uploaded photos, already resolved to URLs. */
  images: { src: string; filter: string }[];
  /** Which animated segment of the video this is (0, 1, …), to vary photos between them. */
  index: number;
  letterbox: number;
  captionBottom: number;
  /** Every narrated word, for kinetic typography and item timing. */
  words: TimedWord[];
}> = ({ beats, from, durationInFrames, theme, format, images, index, letterbox, captionBottom, words }) => {
  const { fps, width, height } = useVideoConfig();
  const vertical = format === "shorts";
  const box = (canvas: { w: number; h: number }, top: number, bottom: number, side: number): Box => {
    const availW = width - side * 2;
    const availH = height - top - bottom;
    const scale = Math.min(availW / canvas.w, availH / canvas.h);
    return { ...canvas, scale, left: (width - canvas.w * scale) / 2, top: top + (availH - canvas.h * scale) / 2 };
  };
  const full = vertical
    ? box(FULL.shorts, 250, 560, 70)
    : box(FULL.landscape, Math.max(80, letterbox + 40), Math.max(90, letterbox + 40), 150);
  const upper = vertical
    ? box(UPPER.shorts, 250, captionBottom + 180, 80)
    : box(UPPER.landscape, Math.max(70, letterbox + 40), captionBottom + 190, 150);
  const starts = beats.map((beat, i) => (i === 0 ? 0 : Math.round(beat.start * fps) - from));
  const pick = (k: number) => images[((k % images.length) + images.length) % images.length] ?? { src: "", filter: "" };
  // Snow when the narration talks about it; otherwise the niche's particles.
  const segWords = words.filter((w) => w.start >= from / fps && w.start < (from + durationInFrames) / fps);
  const snowy = segWords.some((w) => /^(snow\w*|winter|freezing|blizzard|frost\w*)$/i.test(w.text.replace(/[^\p{L}]/gu, "")));

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: theme.bg[0] }}>
      {beats.map((beat, i) => {
        const start = starts[i];
        const end = i === beats.length - 1 ? durationInFrames : starts[i + 1];
        if (end <= start) return null;
        const ctx: Ctx = {
          theme,
          vertical,
          fps,
          beatFrom: from + start,
          length: end - start,
          words,
          uid: `b${from}-${i}`,
          full,
          upper,
          frameW: width,
          frameH: height,
          photo: pick(index * 3 + i),
          photo2: pick(index * 3 + i + 1),
          focus: index * 5 + i,
        };
        return (
          <Sequence key={i} from={start} durationInFrames={end - start} layout="none">
            <Beat beat={beat} ctx={ctx} />
          </Sequence>
        );
      })}
      <Particles kind={snowy ? "snow" : theme.particles} theme={theme} from={from} />
      {starts.map((at, i) => (
        <Sequence key={`s${i}`} from={at + (i === 0 ? 4 : 2)} durationInFrames={22} layout="none">
          <LightStreak theme={theme} seed={from + i} />
        </Sequence>
      ))}
      {starts.slice(1).map((at, i) => (
        <Sequence key={`c${i}`} from={at - CUT} durationInFrames={CUT * 2} layout="none">
          <Cut kind={theme.cut} theme={theme} seed={from + i} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const Beat: React.FC<{ beat: AnimBeat; ctx: Ctx }> = ({ beat, ctx }) => {
  switch (beat.kind) {
    case "words":
      return <WordsBeat beat={beat} ctx={ctx} />;
    case "title":
      return <TitleBeat beat={beat} ctx={ctx} />;
    case "stat":
      return <StatBeat beat={beat} ctx={ctx} />;
    case "streak":
      return <StreakBeat beat={beat} ctx={ctx} />;
    case "pictogram":
      return <PictogramBeat beat={beat} ctx={ctx} />;
    case "bars":
      return <BarsBeat beat={beat} ctx={ctx} />;
    case "line":
      return <LineBeat beat={beat} ctx={ctx} />;
    case "compare":
      return <CompareBeat beat={beat} ctx={ctx} />;
    case "bullets":
      return <ListBeat beat={beat} ctx={ctx} />;
    case "steps":
      return <StepsBeat beat={beat} ctx={ctx} />;
  }
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Approximate glyph width per font, in em, for fitting text to a width. */
const CHAR_EM: Record<FontKey, number> = {
  montserrat: 0.66,
  inter: 0.6,
  bebas: 0.42,
  spaceGrotesk: 0.6,
  merriweather: 0.64,
  bangers: 0.5,
  poppins: 0.66,
  anton: 0.47,
};

/** Largest size up to `base` at which `text` fits in `lines` lines of `maxWidth` px. */
function fit(text: string, base: number, maxWidth: number, lines: number, font: FontKey, uppercase = false): number {
  const em = CHAR_EM[font] * (uppercase && font !== "bebas" && font !== "anton" ? 1.12 : 1);
  return Math.round(Math.min(base, (maxWidth * lines) / (Math.max(1, text.length) * em)));
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, "$&$&") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Kinetic type is set in capitals, except in the serif (documentary) style. */
const caps = (theme: AnimationTheme) => theme.heading !== "merriweather";

const heading = (theme: AnimationTheme, size: number, upper = caps(theme)): CSSProperties => ({
  fontFamily: `"${fontFamily(theme.heading)}", "Arial Black", Arial, sans-serif`,
  fontWeight: FONTS[theme.heading].weight,
  fontSize: size,
  lineHeight: 0.96,
  color: theme.text,
  textTransform: upper ? "uppercase" : "none",
  letterSpacing: theme.heading === "bebas" || theme.heading === "anton" ? "0.01em" : "-0.01em",
  ...CRISP_TEXT,
});

const body = (theme: AnimationTheme, size: number): CSSProperties => ({
  fontFamily: `"${fontFamily(theme.body)}", Arial, sans-serif`,
  fontWeight: FONTS[theme.body].weight,
  fontSize: size,
  lineHeight: 1.2,
  color: theme.text,
  ...CRISP_TEXT,
});

/** Small, widely spaced capitals: the "label" voice of the motion graphics. */
const overline = (theme: AnimationTheme, size: number, color = theme.accent): CSSProperties => ({
  ...body(theme, size),
  textTransform: "uppercase",
  letterSpacing: "0.26em",
  color,
});

const SHADOW = "0 6px 34px rgba(0,0,0,0.7)";
const glow = (color: string) => `0 0 50px ${rgba(color, 0.55)}, ${SHADOW}`;

type SpringConfig = { damping?: number; stiffness?: number; mass?: number };

function springAt(frame: number, fps: number, delay: number, config: SpringConfig = {}) {
  return spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 160, mass: 0.7, ...config } });
}

/** Beat-local frame at which something timed on the video's timeline (seconds) happens. */
const localFrame = (ctx: Ctx, at: number) => Math.round(at * ctx.fps) - ctx.beatFrom;

/** Places children on a design canvas scaled into the frame. */
const Canvas: React.FC<{ box: Box; children: ReactNode; style?: CSSProperties }> = ({ box, children, style }) => (
  <div style={{ position: "absolute", left: box.left, top: box.top, width: box.w, height: box.h, transform: `scale(${box.scale})`, transformOrigin: "top left", ...style }}>
    {children}
  </div>
);

const FOCI = ["35% 40%", "65% 38%", "50% 30%", "40% 62%", "62% 58%", "50% 50%"];

/**
 * The photo behind a moment: pushed in slowly from a different framing each
 * time, settling in after the cut, darkened and tinted so text reads on it.
 * `shake`/`punch` jolt the camera when a word lands.
 */
const Stage: React.FC<{ ctx: Ctx; dark: number; shake?: { x: number; y: number }; punch?: number; children: ReactNode }> = ({
  ctx,
  dark,
  shake = { x: 0, y: 0 },
  punch = 0,
  children,
}) => {
  const frame = useCurrentFrame();
  const settle = interpolate(frame, [0, 12], [0.1, 0], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const scale = 1.1 + 0.1 * (frame / Math.max(1, ctx.length)) + settle + punch;
  const drift = ((ctx.focus % 2 ? 1 : -1) * 18 * frame) / Math.max(1, ctx.length);
  const { theme } = ctx;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${shake.x + drift}px, ${shake.y}px)` }}>
        {ctx.photo.src ? (
          <Img
            src={ctx.photo.src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: ctx.photo.filter || undefined,
              transform: `scale(${scale})`,
              transformOrigin: FOCI[ctx.focus % FOCI.length],
            }}
          />
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${dark})` }} />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${theme.tint} 0%, rgba(0,0,0,0) 45%, ${theme.tint} 100%)` }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.65) 100%)" }} />
      <AbsoluteFill style={{ transform: `translate(${shake.x * 0.6}px, ${shake.y * 0.6}px)` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Atmosphere: particles, light streaks, cuts
// ---------------------------------------------------------------------------

const Particles: React.FC<{ kind: AnimationTheme["particles"]; theme: AnimationTheme; from: number }> = ({ kind, theme, from }) => {
  const frame = useCurrentFrame() + from;
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const count = { dust: 46, embers: 34, bokeh: 16, snow: 90, digital: 30 }[kind];
  const r = (k: string, i: number) => random(`${kind}-${k}-${i}`);
  const wrap = (v: number, span: number) => ((v % span) + span) % span;
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      {kind === "bokeh" ? (
        <defs>
          <radialGradient id="bokeh-a">
            <stop offset="0%" stopColor={theme.accent} stopOpacity={0.5} />
            <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="bokeh-w">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
          </radialGradient>
        </defs>
      ) : null}
      {Array.from({ length: count }, (_, i) => {
        const speed = 0.4 + r("v", i);
        const sway = Math.sin(t * (0.6 + r("f", i)) + i) * 30;
        const x0 = r("x", i) * width;
        const y0 = r("y", i) * height;
        switch (kind) {
          case "dust": {
            const x = wrap(x0 + t * 12 * speed + sway, width);
            const y = wrap(y0 - t * 8 * speed, height);
            const size = 1 + r("s", i) * 2.6;
            return <circle key={i} cx={x} cy={y} r={size} fill="#ffffff" opacity={0.15 + 0.35 * Math.abs(Math.sin(t * 1.3 + i))} />;
          }
          case "embers": {
            const y = wrap(y0 - t * 70 * speed, height + 40);
            const x = x0 + sway * 1.6;
            const size = 1.5 + r("s", i) * 3.5;
            const color = i % 3 ? "#FFB347" : "#FF6A2B";
            return (
              <g key={i} opacity={0.4 + 0.6 * Math.abs(Math.sin(t * 3 + i))}>
                <circle cx={x} cy={y} r={size * 2.6} fill={color} opacity={0.18} />
                <circle cx={x} cy={y} r={size} fill={color} />
              </g>
            );
          }
          case "bokeh": {
            const x = wrap(x0 + t * 10 * speed, width + 200) - 100;
            const y = y0 + Math.sin(t * 0.4 + i) * 40;
            const size = 40 + r("s", i) * 110;
            return <circle key={i} cx={x} cy={y} r={size} fill={`url(#bokeh-${i % 2 ? "a" : "w"})`} opacity={0.6 + 0.4 * Math.sin(t * 0.7 + i)} />;
          }
          case "snow": {
            const y = wrap(y0 + t * 90 * speed, height + 20);
            const x = wrap(x0 + sway * 1.4 + t * 15, width);
            const size = 1.5 + r("s", i) * 3.5;
            return <circle key={i} cx={x} cy={y} r={size} fill="#ffffff" opacity={0.35 + 0.5 * r("o", i)} />;
          }
          case "digital": {
            const y = wrap(y0 - t * 40 * speed, height);
            const size = 3 + r("s", i) * 7;
            const on = Math.sin(t * 5 + i * 1.7) > -0.2;
            return on ? <rect key={i} x={x0} y={y} width={size} height={size} fill={i % 2 ? theme.accent : theme.accent2} opacity={0.35} /> : null;
          }
        }
      })}
    </svg>
  );
};

/** An anamorphic light streak racing across the frame as a moment begins. */
const LightStreak: React.FC<{ theme: AnimationTheme; seed: number }> = ({ theme, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const p = interpolate(frame, [0, 22], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.quad) });
  const y = (0.2 + random(`streak-${seed}`) * 0.6) * height;
  const x = interpolate(p, [0, 1], [-width * 0.6, width * 1.1]);
  const opacity = Math.sin(p * Math.PI);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: x,
          top: y - 60,
          width: width * 0.7,
          height: 120,
          opacity: opacity * 0.55,
          background: `radial-gradient(ellipse at center, ${rgba(theme.accent, 0.55)} 0%, ${rgba(theme.accent, 0)} 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x,
          top: y - 2,
          width: width * 0.7,
          height: 4,
          opacity,
          background: `linear-gradient(90deg, rgba(255,255,255,0), #ffffff 50%, rgba(255,255,255,0))`,
        }}
      />
    </AbsoluteFill>
  );
};

/** The hit between two moments: a white flash, a film burn, a glitch or a dip to black. */
const Cut: React.FC<{ kind: AnimationTheme["cut"]; theme: AnimationTheme; seed: number }> = ({ kind, theme, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // 0 at the start, 1 at the cut itself (the midpoint), back to 0.
  const peak = 1 - Math.abs(frame - CUT) / CUT;
  if (kind === "flash") {
    return <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: Math.pow(clamp01(peak), 1.6) * 0.9 }} />;
  }
  if (kind === "fade") {
    return <AbsoluteFill style={{ backgroundColor: "#000000", opacity: clamp01(peak * 1.2) }} />;
  }
  if (kind === "burn") {
    const x = interpolate(frame, [0, CUT * 2], [-0.2, 1.2]) * width;
    return (
      <AbsoluteFill style={{ opacity: clamp01(peak * 1.4) }}>
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 90% at ${x}px 50%, rgba(255,220,150,1) 0%, rgba(255,120,30,0.9) 35%, rgba(120,20,0,0.85) 70%, rgba(0,0,0,0.9) 100%)` }} />
      </AbsoluteFill>
    );
  }
  // Glitch: bands of the frame shoved sideways in the accent colours.
  const bands = 7;
  return (
    <AbsoluteFill style={{ opacity: clamp01(peak * 1.5) }}>
      <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0.55)" }} />
      {Array.from({ length: bands }, (_, i) => {
        const r = (k: string) => random(`glitch-${seed}-${frame}-${k}-${i}`);
        const h = (height / bands) * (0.3 + r("h") * 0.9);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: (r("x") - 0.5) * width * 0.4,
              top: r("y") * height,
              width: width * 1.2,
              height: h,
              backgroundColor: i % 3 === 0 ? theme.accent : i % 3 === 1 ? theme.accent2 : "#ffffff",
              opacity: 0.35 + r("o") * 0.5,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Kinetic typography
// ---------------------------------------------------------------------------

/** How far into its entrance (0 → 1) a word is, `frames` after it's spoken. */
const landed = (t: number, at: number, fps: number, frames = 6) => clamp01(((t - at) * fps) / frames);

/**
 * The narration, a phrase at a time, each word slamming in as it's spoken.
 * The key word of each phrase lands biggest, in the accent colour, and
 * jolts the camera.
 */
const WordsBeat: React.FC<{ beat: Extract<AnimBeat, { kind: "words" }>; ctx: Ctx }> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const { fps, vertical, theme } = ctx;
  const t = (ctx.beatFrom + frame) / fps;
  const cards = useMemo(
    () => kineticCards(ctx.words, beat.start, beat.end, vertical ? 3 : 4, beat.emphasis),
    [ctx.words, beat.start, beat.end, vertical, beat.emphasis],
  );
  let index = 0;
  cards.forEach((c, i) => {
    if (t >= c.start) index = i;
  });
  const card = cards[index];
  // Camera jolt when the key word lands.
  let shake = { x: 0, y: 0 };
  let punch = 0;
  if (card) {
    const dt = t - card.words[card.key].start;
    if (dt >= 0 && dt < 0.4) {
      const amp = 16 * (1 - dt / 0.4) ** 2;
      shake = { x: amp * Math.sin(dt * 95), y: amp * Math.cos(dt * 71) };
      punch = 0.035 * (1 - dt / 0.4);
    }
  }
  return (
    <Stage ctx={ctx} dark={0.22} shake={shake} punch={punch}>
      <Canvas box={ctx.full}>
        {card ? <KineticCardView key={index} card={card} ctx={ctx} t={t} /> : null}
      </Canvas>
    </Stage>
  );
};

const KineticCardView: React.FC<{ card: KineticCard; ctx: Ctx; t: number }> = ({ card, ctx, t }) => {
  const { theme, fps } = ctx;
  const { w: W, h: H } = ctx.full;
  const upper = caps(theme);
  const exit = interpolate(t, [card.end - 0.14, card.end], [0, 1], CLAMP);
  const container: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    opacity: 1 - exit,
    transform: `scale(${1 + exit * 0.12})`,
  };
  const word = (w: TimedWord, i: number, size: number, extra: CSSProperties = {}) => {
    const key = i === card.key;
    const e = landed(t, w.start, fps, key ? 7 : 5);
    const visible = t >= w.start - 0.02;
    const grow = (key ? 1.3 : 0.75) * (1 - Easing.out(Easing.cubic)(e));
    return (
      <span
        key={i}
        style={{
          display: "inline-block",
          position: "relative",
          ...heading(theme, size, upper),
          color: key ? theme.accent : theme.text,
          textShadow: key ? glow(theme.accent) : SHADOW,
          opacity: visible ? Math.min(1, e * 2.2) : 0,
          transform: `scale(${1 + grow})`,
          filter: e < 1 ? `blur(${(1 - e) * 8}px)` : undefined,
          ...extra,
        }}
      >
        {w.text.replace(/[,;:—–]+$/, "")}
        {/* A ghost of the key word bursting outwards as it lands. */}
        {key && visible && e > 0 ? (
          <span
            style={{
              position: "absolute",
              inset: 0,
              color: "transparent",
              WebkitTextStroke: `3px ${theme.accent}`,
              opacity: (1 - landed(t, w.start, fps, 16)) * 0.7,
              transform: `scale(${1 + landed(t, w.start, fps, 16) * 0.45})`,
              textShadow: "none",
            }}
          >
            {w.text.replace(/[,;:—–]+$/, "")}
          </span>
        ) : null}
      </span>
    );
  };
  const text = (w: TimedWord) => w.text.replace(/[,;:—–]+$/, "");

  if (card.layout === "hero") {
    const key = card.words[card.key];
    const before = card.words.slice(0, card.key);
    const after = card.words.slice(card.key + 1);
    const small = Math.round(H * (ctx.vertical ? 0.075 : 0.085));
    const bigSize = fit(text(key), H * (ctx.vertical ? 0.36 : 0.5), W * 0.96, 1, theme.heading, upper);
    const line = (ws: TimedWord[], offset: number) =>
      ws.length ? (
        <div style={{ display: "flex", gap: small * 0.35, justifyContent: "center", flexWrap: "wrap", letterSpacing: "0.12em" }}>
          {ws.map((w, j) => word(w, offset + j, fit(ws.map(text).join(" "), small, W * 0.9, 1, theme.heading, upper)))}
        </div>
      ) : null;
    const bar = landed(t, key.start + 0.1, fps, 8);
    return (
      <div style={container}>
        {line(before, 0)}
        <div style={{ margin: `${H * 0.02}px 0` }}>{word(key, card.key, bigSize)}</div>
        <div style={{ width: W * 0.28 * bar, height: 8, background: theme.accent, borderRadius: 4, boxShadow: glow(theme.accent), marginBottom: H * 0.02 }} />
        {line(after, card.key + 1)}
      </div>
    );
  }

  if (card.layout === "stack") {
    // One word per line, each as big as its line allows: short words get huge.
    const n = card.words.length;
    const lineMax = (H * 0.92) / n / 0.98;
    return (
      <div style={{ ...container, gap: 0 }}>
        {card.words.map((w, i) => {
          const size = fit(text(w), Math.min(lineMax, H * 0.42) * (i === card.key ? 1.1 : 1), W * 0.92, 1, theme.heading, upper);
          return (
            <div key={i} style={{ lineHeight: 0.98 }}>
              {word(w, i, size)}
            </div>
          );
        })}
      </div>
    );
  }

  // "line": the phrase on one or two lines, the key word a size up.
  const phrase = card.words.map(text).join(" ");
  const size = fit(phrase, H * (ctx.vertical ? 0.2 : 0.3), W * 0.94, 2, theme.heading, upper);
  return (
    <div style={container}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", columnGap: size * 0.28, rowGap: size * 0.05, maxWidth: W * 0.98 }}>
        {card.words.map((w, i) => word(w, i, i === card.key ? size * 1.18 : size))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Data moments
// ---------------------------------------------------------------------------

type BeatOf<K extends AnimBeat["kind"]> = Extract<AnimBeat, { kind: K }>;

/** A thin accent rule that draws out from the centre. */
const Rule: React.FC<{ width: number; delay: number; ctx: Ctx; align?: "center" | "left" }> = ({ width, delay, ctx, align = "center" }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [delay, delay + 14], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ width, height: 4, display: "flex", justifyContent: align === "center" ? "center" : "flex-start" }}>
      <div style={{ width: width * p, height: 4, background: ctx.theme.accent, boxShadow: glow(ctx.theme.accent), borderRadius: 2 }} />
    </div>
  );
};

/** Text that fades up into place `delay` frames into the beat. */
const Rise: React.FC<{ delay: number; children: ReactNode; style?: CSSProperties; distance?: number }> = ({ delay, children, style, distance = 30 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = springAt(frame, fps, delay);
  return <div style={{ opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * distance}px)`, ...style }}>{children}</div>;
};

/** Letters closing in from wide spacing: the chapter-card look. */
const TrackIn: React.FC<{ text: string; style: CSSProperties; delay: number }> = ({ text, style, delay }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [delay, delay + 26], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  return <div style={{ ...style, letterSpacing: `${0.02 + (1 - p) * 0.5}em`, opacity: p, filter: p < 1 ? `blur(${(1 - p) * 6}px)` : undefined }}>{text}</div>;
};

const TitleBeat: React.FC<{ beat: BeatOf<"title">; ctx: Ctx }> = ({ beat, ctx }) => {
  const { theme, upper } = ctx;
  const size = fit(beat.title, ctx.vertical ? 130 : 150, upper.w * 0.9, ctx.vertical ? 3 : 2, theme.heading, caps(theme));
  return (
    <Stage ctx={ctx} dark={0.35}>
      <Canvas box={upper} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 26 }}>
        {beat.subtitle ? (
          <Rise delay={2}>
            <div style={overline(theme, 30)}>{beat.subtitle}</div>
          </Rise>
        ) : null}
        <Rule width={upper.w * 0.5} delay={4} ctx={ctx} />
        <TrackIn text={beat.title} delay={6} style={{ ...heading(theme, size), textShadow: SHADOW, maxWidth: upper.w * 0.95 }} />
        <Rule width={upper.w * 0.5} delay={10} ctx={ctx} />
      </Canvas>
    </Stage>
  );
};

const StatBeat: React.FC<{ beat: BeatOf<"stat">; ctx: Ctx }> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const { theme, upper, fps, vertical } = ctx;
  const count = interpolate(frame, [6, 6 + fps * 1.5], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const year = !beat.prefix && !beat.suffix && Number.isInteger(beat.value) && beat.value >= 1000 && beat.value <= 2100;
  const from = year ? beat.value - 40 : 0;
  const shown = formatNumber(from + (beat.value - from) * count, beat.decimals);
  const full = `${beat.prefix}${formatNumber(beat.value, beat.decimals)}${beat.suffix}`;
  const land = springAt(frame, fps, 6 + fps * 1.5, { damping: 9, stiffness: 220 });
  const percent = beat.suffix === "%" && beat.value > 0 && beat.value <= 100;
  const label = (
    <Rise delay={14}>
      <div style={{ ...overline(theme, vertical ? 34 : 36, theme.text), maxWidth: upper.w * 0.9, textAlign: "center", lineHeight: 1.5 }}>{beat.label}</div>
    </Rise>
  );

  if (percent) {
    const size = vertical ? 560 : 470;
    const r = size / 2 - 20;
    const c = 2 * Math.PI * r;
    return (
      <Stage ctx={ctx} dark={0.46}>
        <Canvas box={upper} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30 }}>
          <div style={{ position: "relative", width: size, height: size }}>
            <svg width={size} height={size} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
              {Array.from({ length: 60 }, (_, i) => {
                const a = (i / 60) * Math.PI * 2;
                const on = i / 60 <= (beat.value / 100) * count;
                return (
                  <line
                    key={i}
                    x1={size / 2 + Math.cos(a - Math.PI / 2) * (r + 26)}
                    y1={size / 2 + Math.sin(a - Math.PI / 2) * (r + 26)}
                    x2={size / 2 + Math.cos(a - Math.PI / 2) * (r + 38)}
                    y2={size / 2 + Math.sin(a - Math.PI / 2) * (r + 38)}
                    stroke={on ? theme.accent : "rgba(255,255,255,0.25)"}
                    strokeWidth={3}
                  />
                );
              })}
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={12} />
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={rgba(theme.accent, 0.35)} strokeWidth={30} strokeDasharray={c} strokeDashoffset={c * (1 - (beat.value / 100) * count)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={theme.accent} strokeWidth={12} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - (beat.value / 100) * count)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ ...heading(theme, size * 0.3), textShadow: SHADOW, fontVariantNumeric: "tabular-nums", transform: `scale(${1 + 0.08 * (1 - land)})` }}>
                {shown}
                <span style={{ color: theme.accent }}>%</span>
              </div>
            </div>
          </div>
          {label}
        </Canvas>
      </Stage>
    );
  }
  return (
    <Stage ctx={ctx} dark={0.42}>
      <Canvas box={upper} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
        <div
          style={{
            ...heading(theme, fit(full, vertical ? 330 : 380, upper.w * 0.95, 1, theme.heading)),
            textShadow: glow(theme.accent),
            fontVariantNumeric: "tabular-nums",
            transform: `scale(${1 + 0.1 * (1 - land)})`,
            whiteSpace: "nowrap",
          }}
        >
          {beat.prefix ? <span style={{ color: theme.accent }}>{beat.prefix}</span> : null}
          {shown}
          {beat.suffix ? <span style={{ color: theme.accent }}>{beat.suffix}</span> : null}
        </div>
        <Rule width={upper.w * 0.45} delay={10} ctx={ctx} />
        {label}
      </Canvas>
    </Stage>
  );
};

/** A calendar of days, crossed off one after another, with the day count ticking up. */
const StreakBeat: React.FC<{ beat: BeatOf<"streak">; ctx: Ctx }> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const { theme, upper, fps, vertical } = ctx;
  const cols = beat.total <= 49 ? 7 : 10;
  const rows = Math.ceil(beat.total / cols);
  const gridW = vertical ? upper.w * 0.92 : upper.w * 0.46;
  const gridH = vertical ? upper.h * 0.55 : upper.h * 0.92;
  const cell = Math.min(gridW / cols, gridH / rows);
  const markFrames = Math.min(fps * 2.2, ctx.length * 0.5);
  const per = markFrames / beat.marked;
  const done = Math.min(beat.marked, Math.max(0, Math.floor((frame - 8) / per) + 1));
  return (
    <Stage ctx={ctx} dark={0.5}>
      <Canvas box={upper} style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", justifyContent: "center", gap: vertical ? 40 : 90 }}>
        <svg width={cell * cols} height={cell * rows} style={{ overflow: "visible", flex: "none" }}>
          {Array.from({ length: beat.total }, (_, i) => {
            const x = (i % cols) * cell;
            const y = Math.floor(i / cols) * cell;
            const at = 8 + i * per;
            const draw = i < beat.marked ? interpolate(frame, [at, at + 5], [0, 1], CLAMP) : 0;
            const appear = interpolate(frame, [i * 0.4, i * 0.4 + 8], [0, 1], CLAMP);
            const pad = cell * 0.2;
            const today = i === beat.marked - 1 && draw > 0;
            return (
              <g key={i} opacity={appear}>
                <rect x={x + 4} y={y + 4} width={cell - 8} height={cell - 8} rx={cell * 0.12} fill={today ? rgba(theme.accent, 0.25) : "rgba(255,255,255,0.05)"} stroke={today ? theme.accent : "rgba(255,255,255,0.3)"} strokeWidth={2} />
                {draw > 0 ? (
                  <g stroke={theme.accent} strokeWidth={Math.max(4, cell * 0.09)} strokeLinecap="round">
                    <line x1={x + pad} y1={y + pad} x2={x + pad + (cell - pad * 2) * Math.min(1, draw * 2)} y2={y + pad + (cell - pad * 2) * Math.min(1, draw * 2)} />
                    {draw > 0.5 ? <line x1={x + cell - pad} y1={y + pad} x2={x + cell - pad - (cell - pad * 2) * (draw - 0.5) * 2} y2={y + pad + (cell - pad * 2) * (draw - 0.5) * 2} /> : null}
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", alignItems: vertical ? "center" : "flex-start", gap: 18, textAlign: vertical ? "center" : "left", maxWidth: vertical ? upper.w : upper.w * 0.42 }}>
          <div style={overline(theme, 34)}>day</div>
          <div style={{ ...heading(theme, vertical ? 260 : 300), textShadow: glow(theme.accent), fontVariantNumeric: "tabular-nums", lineHeight: 0.85 }}>{done}</div>
          <Rise delay={16}>
            <div style={{ ...overline(theme, vertical ? 32 : 32, theme.text), lineHeight: 1.5 }}>{beat.label}</div>
          </Rise>
        </div>
      </Canvas>
    </Stage>
  );
};

const PERSON = "M0 -58 a16 16 0 1 0 0.01 0 Z M-24 36 L-24 -2 Q-24 -20 -6 -20 L6 -20 Q24 -20 24 -2 L24 36 Q24 40 20 40 L-20 40 Q-24 40 -24 36 Z";

const PictogramBeat: React.FC<{ beat: BeatOf<"pictogram">; ctx: Ctx }> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const { theme, upper, fps, vertical } = ctx;
  const hundred = beat.total === 100;
  const cols = hundred ? 10 : beat.total <= 5 ? beat.total : Math.ceil(beat.total / 2);
  const rows = Math.ceil(beat.total / cols);
  const gridW = vertical ? upper.w : upper.w * 0.54;
  const gridH = vertical ? upper.h * 0.5 : upper.h * 0.9;
  const cell = Math.min(gridW / cols, gridH / rows);
  const step = hundred ? 0.7 : 5;
  const lit = Math.min(beat.filled, Math.max(0, Math.floor((frame - 10) / step) + 1));
  return (
    <Stage ctx={ctx} dark={0.5}>
      <Canvas box={upper} style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", justifyContent: "center", gap: vertical ? 40 : 80 }}>
        <svg width={cell * cols} height={cell * rows} style={{ flex: "none", overflow: "visible" }}>
          {Array.from({ length: beat.total }, (_, i) => {
            const on = i < lit;
            const pop = on ? springAt(frame, fps, 10 + i * step, { damping: 9, stiffness: 240 }) : 0;
            const s = (cell / 140) * (1 + 0.2 * Math.max(0, Math.sin(Math.min(1, pop) * Math.PI)));
            return (
              <g key={i} transform={`translate(${(i % cols) * cell + cell / 2} ${Math.floor(i / cols) * cell + cell * 0.58}) scale(${s})`}>
                <path d={PERSON} fill={on ? theme.accent : "rgba(255,255,255,0.22)"} />
              </g>
            );
          })}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", alignItems: vertical ? "center" : "flex-start", gap: 20, textAlign: vertical ? "center" : "left", maxWidth: vertical ? upper.w : upper.w * 0.4 }}>
          <div style={{ ...heading(theme, vertical ? 170 : 190), textShadow: glow(theme.accent), fontVariantNumeric: "tabular-nums", lineHeight: 0.9 }}>
            {hundred ? (
              <>
                {lit}
                <span style={{ color: theme.accent }}>%</span>
              </>
            ) : (
              <>
                {lit} <span style={{ color: theme.accent }}>/ {beat.total}</span>
              </>
            )}
          </div>
          <Rise delay={14}>
            <div style={{ ...overline(theme, 32, theme.text), lineHeight: 1.5 }}>{beat.label}</div>
          </Rise>
        </div>
      </Canvas>
    </Stage>
  );
};

/** How a value is written with its unit: "$12", "45%", "3.5 kg". */
function withUnit(value: string, unit: string): string {
  if (!unit) return value;
  if (/^[$€£]$/.test(unit)) return unit + value;
  return unit.length <= 2 || unit === "%" ? value + unit : `${value} ${unit}`;
}

const BarsBeat: React.FC<{ beat: BeatOf<"bars">; ctx: Ctx }> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const { theme, upper, fps, vertical } = ctx;
  const max = Math.max(...beat.bars.map((b) => b.value));
  const n = beat.bars.length;
  const rowH = Math.min(vertical ? 150 : 104, (upper.h - (beat.title ? 130 : 20)) / n);
  return (
    <Stage ctx={ctx} dark={0.52}>
      <Canvas box={upper} style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {beat.title ? (
          <Rise delay={0} style={{ marginBottom: 34 }}>
            <div style={overline(theme, 32)}>{beat.title}</div>
          </Rise>
        ) : null}
        {beat.bars.map((bar, i) => {
          const grow = springAt(frame, fps, 8 + i * 6, { damping: 24, stiffness: 70, mass: 1 });
          const top = bar.value === max;
          const width = (bar.value / max) * grow;
          const value = withUnit(formatNumber(bar.value * grow, Number.isInteger(bar.value) ? 0 : 1), beat.unit);
          const labelEl = <div style={{ ...overline(theme, vertical ? 28 : 26, top ? theme.accent : theme.muted), letterSpacing: "0.18em", whiteSpace: "nowrap" }}>{bar.label}</div>;
          const barEl = (
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 24 }}>
              <div style={{ flex: 1, height: 16, borderRadius: 8, background: "rgba(255,255,255,0.1)", position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${width * 100}%`, borderRadius: 8, background: top ? theme.accent : "rgba(255,255,255,0.75)", boxShadow: top ? glow(theme.accent) : "none" }} />
              </div>
              <div style={{ ...heading(theme, vertical ? 60 : 64), width: vertical ? 200 : 230, textShadow: SHADOW, fontVariantNumeric: "tabular-nums", color: top ? theme.accent : theme.text }}>{value}</div>
            </div>
          );
          return vertical ? (
            <div key={i} style={{ height: rowH, display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, opacity: clamp01(grow * 3) }}>
              {labelEl}
              {barEl}
            </div>
          ) : (
            <div key={i} style={{ height: rowH, display: "flex", alignItems: "center", gap: 36, opacity: clamp01(grow * 3) }}>
              <div style={{ width: upper.w * 0.22, display: "flex", justifyContent: "flex-end" }}>{labelEl}</div>
              {barEl}
            </div>
          );
        })}
      </Canvas>
    </Stage>
  );
};

const LineBeat: React.FC<{ beat: BeatOf<"line">; ctx: Ctx }> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const { theme, upper, fps, vertical, uid } = ctx;
  const W = upper.w;
  const H = upper.h;
  const titleSpace = beat.title ? 110 : 0;
  const box = { left: vertical ? 40 : 80, right: W - (vertical ? 70 : 110), top: titleSpace + 80, bottom: H - 70 };
  const values = beat.points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const lo = min > max * 0.6 ? min * 0.85 : 0;
  const hi = max * 1.05;
  const n = beat.points.length;
  const xy = beat.points.map((p, i) => ({
    x: box.left + ((box.right - box.left) * i) / (n - 1),
    y: box.bottom - ((p.value - lo) / (hi - lo)) * (box.bottom - box.top),
  }));
  const d = xy.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const draw = interpolate(frame, [10, 10 + fps * 1.8], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) });
  const pos = draw * (n - 1);
  const k = Math.min(n - 2, Math.floor(pos));
  const u = pos - k;
  const tip = { x: xy[k].x + (xy[k + 1].x - xy[k].x) * u, y: xy[k].y + (xy[k + 1].y - xy[k].y) * u };
  return (
    <Stage ctx={ctx} dark={0.52}>
      <Canvas box={upper}>
        {beat.title ? (
          <Rise delay={0} style={{ position: "absolute", left: box.left, top: 10 }}>
            <div style={overline(theme, 32)}>{beat.title}</div>
          </Rise>
        ) : null}
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <defs>
            <linearGradient id={`${uid}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={theme.accent} stopOpacity={0.35} />
              <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
            </linearGradient>
            <clipPath id={`${uid}-reveal`}>
              <rect x={0} y={0} width={tip.x} height={H} />
            </clipPath>
          </defs>
          {[0, 1, 2, 3].map((i) => {
            const y = box.top + ((box.bottom - box.top) * i) / 3;
            return <line key={i} x1={box.left} x2={box.right} y1={y} y2={y} stroke="rgba(255,255,255,0.12)" strokeWidth={2} />;
          })}
          <path d={`${d} L${box.right} ${box.bottom} L${box.left} ${box.bottom} Z`} fill={`url(#${uid}-area)`} clipPath={`url(#${uid}-reveal)`} />
          <path d={d} fill="none" stroke={theme.accent} strokeOpacity={0.3} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
          <path d={d} fill="none" stroke={theme.accent} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
          {xy.map((p, i) => {
            const reached = springAt(frame, fps, 10 + (fps * 1.8 * i) / (n - 1), { damping: 10, stiffness: 200 });
            return <circle key={i} cx={p.x} cy={p.y} r={10 * reached} fill="#ffffff" stroke={theme.accent} strokeWidth={5} />;
          })}
          {draw > 0 && draw < 1 ? <circle cx={tip.x} cy={tip.y} r={18} fill="#ffffff" opacity={0.9} /> : null}
        </svg>
        {beat.points.map((p, i) => {
          const reached = springAt(frame, fps, 10 + (fps * 1.8 * i) / (n - 1), { damping: 12, stiffness: 180 });
          const last = i === n - 1;
          return (
            <div key={i}>
              <div
                style={{
                  ...heading(theme, last ? 72 : 46),
                  position: "absolute",
                  left: xy[i].x - 150,
                  width: 300,
                  top: xy[i].y - (last ? 100 : 72),
                  textAlign: "center",
                  color: last ? theme.accent : theme.text,
                  textShadow: last ? glow(theme.accent) : SHADOW,
                  opacity: reached,
                  transform: `scale(${reached})`,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {withUnit(formatNumber(p.value, Number.isInteger(p.value) ? 0 : 1), beat.unit)}
              </div>
              <div style={{ ...overline(theme, 24, theme.muted), position: "absolute", left: xy[i].x - 110, width: 220, top: box.bottom + 22, textAlign: "center", letterSpacing: "0.16em" }}>{p.label}</div>
            </div>
          );
        })}
      </Canvas>
    </Stage>
  );
};

/** Split screen: two photos, a glowing divider drawing between them, each side's case. */
const CompareBeat: React.FC<{ beat: BeatOf<"compare">; ctx: Ctx }> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const { theme, upper, fps, vertical, frameW, frameH } = ctx;
  const split = vertical ? upper.top + (upper.h * upper.scale) / 2 : frameW / 2;
  const open = springAt(frame, fps, 0, { damping: 20, stiffness: 90 });
  const line = interpolate(frame, [4, 20], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const vs = springAt(frame, fps, 14, { damping: 9, stiffness: 200 });
  const half = (photo: Ctx["photo"], side: 0 | 1) => {
    const rect: CSSProperties = vertical
      ? { left: 0, right: 0, top: side ? split : 0, height: side ? frameH - split : split }
      : { top: 0, bottom: 0, left: side ? split : 0, width: side ? frameW - split : split };
    const offset = (1 - open) * (side ? 1 : -1) * 120;
    return (
      <div style={{ position: "absolute", overflow: "hidden", ...rect }}>
        {photo.src ? (
          <Img
            src={photo.src}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: `${photo.filter} ${side ? "grayscale(0.6)" : ""}`.trim() || undefined,
              transform: `${vertical ? `translateY(${offset}px)` : `translateX(${offset}px)`} scale(${1.15 + 0.06 * (frame / ctx.length)})`,
            }}
          />
        ) : null}
        <div style={{ position: "absolute", inset: 0, background: side ? "rgba(0,0,0,0.62)" : "rgba(0,0,0,0.5)" }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${vertical ? "180deg" : "90deg"}, ${side ? "rgba(0,0,0,0.4)" : theme.tint}, ${side ? theme.tint : "rgba(0,0,0,0.4)"})` }} />
      </div>
    );
  };
  const panel = (data: BeatOf<"compare">["left"], color: string, delay: number) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", gap: 18, padding: "0 30px" }}>
      <Rise delay={delay}>
        <div style={{ ...heading(theme, fit(data.title, vertical ? 110 : 120, upper.w * 0.42, 1, theme.heading, caps(theme))), color, textShadow: glow(color) }}>{data.title}</div>
      </Rise>
      {data.points.map((pt, j) => (
        <Rise key={j} delay={delay + 8 + j * 6}>
          <div style={{ ...overline(theme, vertical ? 28 : 28, theme.text), letterSpacing: "0.16em", lineHeight: 1.4 }}>{pt}</div>
        </Rise>
      ))}
    </div>
  );
  const dividerLen = (vertical ? frameW : frameH) * line;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {half(ctx.photo, 0)}
      {half(ctx.photo2, 1)}
      <div
        style={{
          position: "absolute",
          background: theme.accent,
          boxShadow: glow(theme.accent),
          ...(vertical ? { top: split - 3, height: 6, left: (frameW - dividerLen) / 2, width: dividerLen } : { left: split - 3, width: 6, top: (frameH - dividerLen) / 2, height: dividerLen }),
        }}
      />
      <Canvas box={upper} style={{ display: "flex", flexDirection: vertical ? "column" : "row" }}>
        {panel(beat.left, theme.accent, 6)}
        {panel(beat.right, "#ffffff", 12)}
      </Canvas>
      <div
        style={{
          ...heading(theme, 44),
          position: "absolute",
          left: (vertical ? frameW / 2 : split) - 50,
          top: (vertical ? split : upper.top + (upper.h * upper.scale) / 2) - 50,
          width: 100,
          height: 100,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: theme.bg[0],
          border: `4px solid ${theme.accent}`,
          boxShadow: glow(theme.accent),
          transform: `scale(${vs})`,
        }}
      >
        vs
      </div>
    </AbsoluteFill>
  );
};

/** Numbered points, each landing as it's said, the latest one lit. */
const ListBeat: React.FC<{ beat: BeatOf<"bullets">; ctx: Ctx }> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const { theme, upper, fps, vertical } = ctx;
  const n = beat.items.length;
  const revealed = beat.items.filter((it) => frame >= localFrame(ctx, it.at)).length;
  const rowH = (upper.h - (beat.title ? 90 : 0)) / n;
  const numSize = Math.min(vertical ? 130 : 120, rowH * 0.8);
  return (
    <Stage ctx={ctx} dark={0.46}>
      <Canvas box={upper} style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: vertical ? 0 : "0 60px" }}>
        {beat.title ? (
          <Rise delay={0} style={{ marginBottom: 20 }}>
            <div style={overline(theme, 32)}>{beat.title}</div>
          </Rise>
        ) : null}
        {beat.items.map((item, i) => {
          const at = localFrame(ctx, item.at);
          const p = springAt(frame, fps, at, { damping: 16, stiffness: 190 });
          const active = i === revealed - 1;
          const rule = interpolate(frame, [at + 2, at + 16], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
          return (
            <div key={i} style={{ height: rowH, display: "flex", flexDirection: "column", justifyContent: "center", opacity: clamp01(p * 1.6) * (active || revealed === 0 ? 1 : 0.55), transform: `translateX(${(1 - p) * -80}px)` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
                <div
                  style={{
                    ...heading(theme, numSize),
                    color: "transparent",
                    WebkitTextStroke: `3px ${active ? theme.accent : "rgba(255,255,255,0.8)"}`,
                    width: numSize * 1.15,
                    flex: "none",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div style={{ ...heading(theme, fit(item.text, Math.min(vertical ? 72 : 80, rowH * 0.5), upper.w - numSize * 1.4 - 100, 2, theme.heading, caps(theme))), textShadow: active ? glow(theme.accent) : SHADOW, color: active ? theme.text : theme.muted, lineHeight: 1.02 }}>
                  {item.text}
                </div>
              </div>
              <div style={{ height: 2, width: `${rule * 100}%`, marginTop: 10, background: active ? theme.accent : "rgba(255,255,255,0.25)" }} />
            </div>
          );
        })}
      </Canvas>
    </Stage>
  );
};

/** Stages along a glowing line; a pulse of light runs to each one as it's named. */
const StepsBeat: React.FC<{ beat: BeatOf<"steps">; ctx: Ctx }> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const { theme, upper, fps, vertical } = ctx;
  const n = beat.items.length;
  const W = upper.w;
  const H = upper.h;
  const titleSpace = beat.title ? 100 : 0;
  const arrive = beat.items.map((it) => localFrame(ctx, it.at));
  const pts = beat.items.map((_, i) =>
    vertical
      ? { x: 70, y: titleSpace + 60 + ((H - titleSpace - 120) * i) / Math.max(1, n - 1) }
      : { x: 90 + ((W - 180) * i) / Math.max(1, n - 1), y: titleSpace + (H - titleSpace) * 0.4 },
  );
  // How far along the line the light has travelled: it reaches stop i as item i is said.
  let reach = 0;
  for (let i = 1; i < n; i++) {
    reach = Math.max(reach, i - 1 + interpolate(frame, [arrive[i] - 0.6 * fps, arrive[i]], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) }));
  }
  const along = (v: number) => {
    const k = Math.min(n - 2, Math.floor(v));
    const u = v - k;
    return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * u, y: pts[k].y + (pts[k + 1].y - pts[k].y) * u };
  };
  const head = along(Math.min(n - 1, reach));
  const started = frame >= arrive[0];
  return (
    <Stage ctx={ctx} dark={0.5}>
      <Canvas box={upper}>
        {beat.title ? (
          <Rise delay={0} style={{ position: "absolute", left: vertical ? 0 : 90, top: 0 }}>
            <div style={overline(theme, 32)}>{beat.title}</div>
          </Rise>
        ) : null}
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <line x1={pts[0].x} y1={pts[0].y} x2={pts[n - 1].x} y2={pts[n - 1].y} stroke="rgba(255,255,255,0.18)" strokeWidth={4} />
          {started ? (
            <>
              <line x1={pts[0].x} y1={pts[0].y} x2={head.x} y2={head.y} stroke={theme.accent} strokeOpacity={0.35} strokeWidth={16} strokeLinecap="round" />
              <line x1={pts[0].x} y1={pts[0].y} x2={head.x} y2={head.y} stroke={theme.accent} strokeWidth={5} strokeLinecap="round" />
              <circle cx={head.x} cy={head.y} r={14 + 3 * Math.sin(frame / 3)} fill="#ffffff" />
            </>
          ) : null}
          {pts.map((p, i) => {
            const lit = springAt(frame, fps, arrive[i], { damping: 9, stiffness: 220 });
            return (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={30 * lit} fill={rgba(theme.accent, 0.25)} />
                <circle cx={p.x} cy={p.y} r={12} fill={lit > 0.05 ? theme.accent : theme.bg[0]} stroke={lit > 0.05 ? theme.accent : "rgba(255,255,255,0.5)"} strokeWidth={4} />
              </g>
            );
          })}
        </svg>
        {beat.items.map((item, i) => {
          const p = springAt(frame, fps, arrive[i], { damping: 16, stiffness: 180 });
          const pt = pts[i];
          const colW = vertical ? W - 170 : (W - 180) / Math.max(1, n - 1);
          const num = <div style={{ ...heading(theme, vertical ? 60 : 64), color: p > 0.05 ? theme.accent : "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }}>{String(i + 1).padStart(2, "0")}</div>;
          const label = <div style={{ ...heading(theme, fit(item.text, vertical ? 58 : 46, colW - 20, 2, theme.heading, caps(theme))), textShadow: SHADOW, lineHeight: 1.04, opacity: clamp01(p * 1.5), transform: `translateY(${(1 - p) * 24}px)` }}>{item.text}</div>;
          return vertical ? (
            <div key={i} style={{ position: "absolute", left: pt.x + 60, top: pt.y - 60, width: colW, height: 120, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
              {num}
              {label}
            </div>
          ) : (
            <div key={i} style={{ position: "absolute", left: pt.x - colW / 2, width: colW, top: pt.y - 110, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              {num}
              <div style={{ height: 120 }} />
              {label}
            </div>
          );
        })}
      </Canvas>
    </Stage>
  );
};
