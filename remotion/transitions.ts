import type { TransitionPresentation, TransitionTiming } from "@remotion/transitions";
import { linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { flip } from "@remotion/transitions/flip";
import { iris } from "@remotion/transitions/iris";
import { pushCut } from "@remotion/transitions/push-cut";
import { slide, type SlideDirection } from "@remotion/transitions/slide";
import { wipe, type WipeDirection } from "@remotion/transitions/wipe";
import { Easing } from "remotion";
import type { TransitionKind } from "../lib/types";
import { dipToBlack, flashCut, glitch, whip, zoomThrough } from "./customTransitions";

const SLIDES: SlideDirection[] = ["from-right", "from-bottom", "from-left", "from-top"];
const WIPES: WipeDirection[] = ["from-left", "from-top-right", "from-bottom", "from-right"];

/** The presentation for the `index`-th cut. Directions vary by index so repeats don't look identical. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function presentationFor(
  kind: TransitionKind,
  index: number,
  size: { width: number; height: number },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): TransitionPresentation<any> {
  switch (kind) {
    case "fade":
      return fade();
    case "slide":
      return slide({ direction: SLIDES[index % SLIDES.length] });
    case "wipe":
      return wipe({ direction: WIPES[index % WIPES.length] });
    case "flip":
      return flip({ direction: index % 2 ? "from-left" : "from-right" });
    case "iris":
      return iris(size);
    case "push":
      return pushCut();
    case "zoom":
      return zoomThrough();
    case "whip":
      return whip(index % 2 ? -1 : 1);
    case "glitch":
      return glitch(index + 1);
    case "flash":
      return flashCut("white");
    case "dip":
      return dipToBlack();
  }
}

/** Motion-heavy transitions ease in and out; the rest run linearly. */
export function timingFor(kind: TransitionKind, frames: number): TransitionTiming {
  const eased = kind === "whip" || kind === "zoom" || kind === "slide" || kind === "push" || kind === "flip";
  return linearTiming({ durationInFrames: frames, easing: eased ? Easing.inOut(Easing.cubic) : undefined });
}
