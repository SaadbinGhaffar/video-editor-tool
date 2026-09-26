import type { CaptionStyleId } from "./types";

export type FontKey =
  | "montserrat"
  | "inter"
  | "bebas"
  | "spaceGrotesk"
  | "merriweather"
  | "bangers"
  | "poppins"
  | "anton";

/** CSS family name and weight of each caption font (all Google Fonts). */
export const FONTS: Record<FontKey, { family: string; weight: number; label: string }> = {
  montserrat: { family: "Montserrat", weight: 900, label: "Montserrat Black" },
  inter: { family: "Inter", weight: 800, label: "Inter ExtraBold" },
  bebas: { family: "Bebas Neue", weight: 400, label: "Bebas Neue" },
  spaceGrotesk: { family: "Space Grotesk", weight: 700, label: "Space Grotesk Bold" },
  merriweather: { family: "Merriweather", weight: 900, label: "Merriweather Black" },
  bangers: { family: "Bangers", weight: 400, label: "Bangers" },
  poppins: { family: "Poppins", weight: 800, label: "Poppins ExtraBold" },
  anton: { family: "Anton", weight: 400, label: "Anton" },
};

/** One Google Fonts stylesheet with exactly the faces above, for the page's style picker. */
export const GOOGLE_FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Montserrat:wght@900&family=Inter:wght@800&family=Bebas+Neue" +
  "&family=Space+Grotesk:wght@700&family=Merriweather:wght@900&family=Bangers&family=Poppins:wght@800" +
  "&family=Anton&display=swap";

export type CaptionLook = {
  label: string;
  font: FontKey;
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

export const CAPTION_LOOKS: Record<CaptionStyleId, CaptionLook> = {
  bold: { label: "Bold", font: "montserrat", size: 106, uppercase: false, color: "#fff", highlight: "#FFD60A", mode: "color", stroke: 14, panel: false, enter: "pop" },
  classic: { label: "Classic YouTube", font: "anton", size: 124, uppercase: true, color: "#fff", highlight: "#FFE45C", mode: "color", stroke: 12, panel: false, enter: "pop", letterSpacing: "0.02em" },
  clean: { label: "Clean", font: "inter", size: 100, uppercase: false, color: "#fff", highlight: "#2563EB", mode: "box", boxText: "#fff", stroke: 0, panel: true, enter: "rise" },
  impact: { label: "Impact", font: "bebas", size: 150, uppercase: true, color: "#fff", highlight: "#FF3B30", mode: "color", stroke: 12, panel: false, enter: "punch", letterSpacing: "0.02em" },
  tech: { label: "Tech", font: "spaceGrotesk", size: 106, uppercase: false, color: "#fff", highlight: "#22D3EE", mode: "color", stroke: 12, panel: false, enter: "rise" },
  cinematic: { label: "Cinematic", font: "merriweather", size: 92, uppercase: false, color: "#F5F1E8", highlight: "#F2C14E", mode: "color", stroke: 10, panel: false, enter: "fade" },
  playful: { label: "Playful", font: "bangers", size: 132, uppercase: true, color: "#fff", highlight: "#39FF6A", mode: "box", boxText: "#111", stroke: 12, panel: false, enter: "bounce", letterSpacing: "0.03em" },
  warm: { label: "Warm", font: "poppins", size: 106, uppercase: false, color: "#fff", highlight: "#FF9F43", mode: "color", stroke: 13, panel: false, enter: "pop" },
};

/** Typography settings that make heavy display fonts render crisply (shared by video and picker). */
export const CRISP_TEXT = {
  WebkitFontSmoothing: "antialiased",
  MozOsxFontSmoothing: "grayscale",
  textRendering: "geometricPrecision",
  fontKerning: "normal",
  fontFeatureSettings: '"kern" 1, "liga" 1',
} as const;
