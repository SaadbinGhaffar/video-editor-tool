import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadBangers } from "@remotion/google-fonts/Bangers";
import { loadFont as loadBebas } from "@remotion/google-fonts/BebasNeue";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMerriweather } from "@remotion/google-fonts/Merriweather";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import type { FontKey } from "../lib/captionLooks";

const subsets = ["latin", "latin-ext"] as ("latin" | "latin-ext")[];

// Only the font a video actually uses is downloaded, once. Each loader holds
// the render (delayRender) until the font file has loaded, so no frame is
// ever drawn with a fallback system font.
const loaders: Record<FontKey, () => string> = {
  montserrat: () => loadMontserrat("normal", { weights: ["900"], subsets }).fontFamily,
  inter: () => loadInter("normal", { weights: ["800"], subsets }).fontFamily,
  bebas: () => loadBebas("normal", { weights: ["400"], subsets }).fontFamily,
  spaceGrotesk: () => loadSpaceGrotesk("normal", { weights: ["700"], subsets }).fontFamily,
  merriweather: () => loadMerriweather("normal", { weights: ["900"], subsets }).fontFamily,
  bangers: () => loadBangers("normal", { weights: ["400"], subsets }).fontFamily,
  poppins: () => loadPoppins("normal", { weights: ["800"], subsets }).fontFamily,
  anton: () => loadAnton("normal", { weights: ["400"], subsets }).fontFamily,
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
