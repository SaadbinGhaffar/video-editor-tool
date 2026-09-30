import { TransitionSeries } from "@remotion/transitions";
import { Fragment } from "react";
import { AbsoluteFill, Audio, staticFile, useVideoConfig } from "remotion";
import { animationTheme } from "../lib/animation";
import type { MainVideoProps } from "../lib/types";
import { effectLook } from "../lib/videoEffects";
import { AnimatedSegment } from "./AnimatedSegment";
import { BackgroundMusic } from "./BackgroundMusic";
import { Captions } from "./Captions";
import { Effects, LETTERBOX_HEIGHT, Letterbox } from "./effects";
import { KenBurnsImage } from "./KenBurnsImage";
import { presentationFor, timingFor } from "./transitions";
import { EffectLayer, EffectOverlays } from "./videoEffects";

/** Remote/blob URLs pass through; anything else is a path in the bundle's public dir. */
const resolveSrc = (src: string) => (/^(https?:|data:|blob:)/.test(src) ? src : staticFile(src));

export const MainVideo: React.FC<MainVideoProps> = ({ audioSrc, audioOffset, scenes, cues, style, music }) => {
  const { fps, durationInFrames, width, height } = useVideoConfig();

  // Each transition is centred on its cut point: scene i (i > 0) starts half a
  // transition before its cut, and every scene but the last runs half a
  // transition past the next cut. TransitionSeries subtracts the overlaps, so
  // the series ends exactly at durationInFrames.
  const half = Math.floor(style.transitionFrames / 2);
  const transition = half * 2;
  const cuts = scenes.map((s) => Math.round(s.start * fps));
  cuts.push(durationInFrames);
  const froms = scenes.map((_, i) => (i === 0 ? 0 : cuts[i] - half));
  const lengths = scenes.map((_, i) => {
    const to = i === scenes.length - 1 ? durationInFrames : cuts[i + 1] + half;
    return Math.max(transition + 1, to - froms[i]);
  });

  const shorts = style.format === "shorts";
  const letterbox = shorts ? 0 : effectLook(style.effect)?.letterbox || (style.effects.letterbox ? LETTERBOX_HEIGHT : 0);
  // Shorts: sit above the title, channel name and buttons YouTube overlays on the lower quarter.
  const captionBottom = shorts ? 560 : letterbox ? letterbox + 90 : 130;
  const animated = scenes.some((s) => s.kind === "animated");
  const theme = animated ? animationTheme(style.niche, style.caption) : null;
  const words = animated ? cues.flatMap((c) => c.words) : [];
  // Kinetic typography shows the narration itself, so the captions step aside meanwhile.
  const kinetic = scenes.flatMap((s) => (s.kind === "animated" ? s.beats.filter((b) => b.kind === "words") : []));
  let animatedIndex = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <EffectLayer effect={style.effect}>
        <TransitionSeries>
          {scenes.map((scene, i) => {
            const kind = style.transitions[i - 1] ?? "fade";
            return (
              <Fragment key={i}>
                {i > 0 ? (
                  <TransitionSeries.Transition
                    presentation={presentationFor(kind, i - 1, { width, height })}
                    timing={timingFor(kind, transition)}
                  />
                ) : null}
                <TransitionSeries.Sequence durationInFrames={lengths[i]}>
                  {scene.kind === "animated" ? (
                    <AnimatedSegment
                      beats={scene.beats}
                      from={froms[i]}
                      durationInFrames={lengths[i]}
                      theme={theme!}
                      format={style.format}
                      images={scene.images.map((im) => ({ src: resolveSrc(im.src), filter: im.filter }))}
                      index={animatedIndex++}
                      letterbox={letterbox}
                      captionBottom={captionBottom}
                      words={words}
                    />
                  ) : (
                    <KenBurnsImage
                      src={resolveSrc(scene.src)}
                      index={i}
                      durationInFrames={lengths[i]}
                      look={scene}
                      kenBurns={style.kenBurns}
                    />
                  )}
                </TransitionSeries.Sequence>
              </Fragment>
            );
          })}
        </TransitionSeries>
      </EffectLayer>
      <Effects effects={style.effects} cutFrames={cuts.slice(1, -1)} />
      <EffectOverlays effect={style.effect} cutFrames={cuts.slice(1, -1)} />
      {letterbox ? <Letterbox height={letterbox} /> : null}
      <Captions cues={cues} styleId={style.caption} bottom={captionBottom} sidePadding={shorts ? 70 : 140} hidden={kinetic} />
      {audioSrc ? <Audio src={resolveSrc(audioSrc)} trimBefore={Math.round(audioOffset * fps)} /> : null}
      {music ? <BackgroundMusic music={music} cues={cues} resolve={resolveSrc} /> : null}
    </AbsoluteFill>
  );
};
