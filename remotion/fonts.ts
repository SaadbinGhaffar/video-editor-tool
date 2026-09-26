import { loadFont as loadBangers } from "@remotion/google-fonts/Bangers";
import { loadFont as loadBebas } from "@remotion/google-fonts/BebasNeue";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMerriweather } from "@remotion/google-fonts/Merriweather";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";

export type FontKey = "montserrat" | "inter" | "bebas" | "spaceGrotesk" | "merriweather" | "bangers" | "poppins";

// Only the font a video actually uses is downloaded, once.
const loaders: Record<FontKey, () => string> = {
  montserrat: () => loadMontserrat("normal", { weights: ["800"], subsets: ["latin", "latin-ext"] }).fontFamily,
  inter: () => loadInter("normal", { weights: ["800"], subsets: ["latin", "latin-ext"] }).fontFamily,
  bebas: () => loadBebas("normal", { weights: ["400"], subsets: ["latin", "latin-ext"] }).fontFamily,
  spaceGrotesk: () => loadSpaceGrotesk("normal", { weights: ["700"], subsets: ["latin", "latin-ext"] }).fontFamily,
  merriweather: () => loadMerriweather("normal", { weights: ["900"], subsets: ["latin", "latin-ext"] }).fontFamily,
  bangers: () => loadBangers("normal", { weights: ["400"], subsets: ["latin", "latin-ext"] }).fontFamily,
  poppins: () => loadPoppins("normal", { weights: ["800"], subsets: ["latin", "latin-ext"] }).fontFamily,
};

const loaded = new Map<FontKey, string>();

export function fontFamily(key: FontKey): string {
  let family = loaded.get(key);
  if (!family) {
    family = loaders[key]();
    loaded.set(key, family);
  }
  return family;
}
