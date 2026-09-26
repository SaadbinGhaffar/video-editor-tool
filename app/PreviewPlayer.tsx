"use client";

import { Player } from "@remotion/player";
import { FPS, VIDEO_HEIGHT, VIDEO_WIDTH, type MainVideoProps } from "@/lib/types";
import { MainVideo } from "@/remotion/MainVideo";

/**
 * Plays the exact composition the server renders, in the browser, using the
 * local files (blob URLs) — nothing is rendered until the user asks for the MP4.
 */
export default function PreviewPlayer({ inputProps }: { inputProps: MainVideoProps }) {
  return (
    <Player
      component={MainVideo}
      inputProps={inputProps}
      durationInFrames={Math.max(1, Math.ceil(inputProps.durationInSeconds * FPS))}
      fps={FPS}
      compositionWidth={VIDEO_WIDTH}
      compositionHeight={VIDEO_HEIGHT}
      controls
      clickToPlay
      doubleClickToFullscreen
      acknowledgeRemotionLicense
      style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 6, overflow: "hidden" }}
    />
  );
}
