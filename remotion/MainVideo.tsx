import { TransitionSeries } from "@remotion/transitions";
import { Fragment } from "react";
import { AbsoluteFill, Audio, staticFile, useVideoConfig } from "remotion";
import type { MainVideoProps } from "../lib/types";
import { Captions } from "./Captions";
import { Effects, LETTERBOX_HEIGHT, Letterbox } from "./effects";
import { KenBurnsImage } from "./KenBurnsImage";
import { presentationFor, timingFor } from "./transitions";

/** Remote/blob URLs pass through; anything else is a path in the bundle's public dir. */
const resolveSrc = (src: string) => (/^(https?:|data:|blob:)/.test(src) ? src : staticFile(src));

export const MainVideo: React.FC<MainVideoProps> = ({ audioSrc, audioOffset, scenes, cues, style }) => {
  const { fps, durationInFrames } = useVideoConfig();

  // Each transition is centred on its cut point: scene i (i > 0) starts half a
  // transition before its cut, and every scene but the last runs half a
  // transition past the next cut. TransitionSeries subtracts the overlaps, so
  // the series ends exactly at durationInFrames.
  const half = Math.floor(style.transitionFrames / 2);
  const transition = half * 2;
  const cuts = scenes.map((s) => Math.round(s.start * fps));
  cuts.push(durationInFrames);
  const lengths = scenes.map((_, i) => {
    const from = i === 0 ? 0 : cuts[i] - half;
    const to = i === scenes.length - 1 ? durationInFrames : cuts[i + 1] + half;
    return Math.max(transition + 1, to - from);
  });

  const captionBottom = style.effects.letterbox ? LETTERBOX_HEIGHT + 90 : 130;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <TransitionSeries>
        {scenes.map((scene, i) => {
          const kind = style.transitions[i - 1] ?? "fade";
          return (
            <Fragment key={i}>
              {i > 0 ? (
                <TransitionSeries.Transition
                  presentation={presentationFor(kind, i - 1)}
                  timing={timingFor(kind, transition)}
                />
              ) : null}
              <TransitionSeries.Sequence durationInFrames={lengths[i]}>
                <KenBurnsImage
                  src={resolveSrc(scene.src)}
                  index={i}
                  durationInFrames={lengths[i]}
                  look={scene}
                  kenBurns={style.kenBurns}
                />
              </TransitionSeries.Sequence>
            </Fragment>
          );
        })}
      </TransitionSeries>
      <Effects effects={style.effects} cutFrames={cuts.slice(1, -1)} />
      {style.effects.letterbox ? <Letterbox /> : null}
      <Captions cues={cues} styleId={style.caption} bottom={captionBottom} />
      {audioSrc ? <Audio src={resolveSrc(audioSrc)} trimBefore={Math.round(audioOffset * fps)} /> : null}
    </AbsoluteFill>
  );
};
