"use client";

import { Player } from "@remotion/player";
import { FORMAT_SIZE, FPS, type MainVideoProps } from "@/lib/types";
import { MainVideo } from "@/remotion/MainVideo";

/**
 * Plays the exact composition the server renders, in the browser, using the
 * local files (blob URLs) — nothing is rendered until the user asks for the MP4.
 */
export default function PreviewPlayer({ inputProps }: { inputProps: MainVideoProps }) {
  const shorts = inputProps.style.format === "shorts";
  const { width, height } = FORMAT_SIZE[inputProps.style.format];
  return (
    <Player
      component={MainVideo}
      inputProps={inputProps}
      durationInFrames={Math.max(1, Math.ceil(inputProps.durationInSeconds * FPS))}
      fps={FPS}
      compositionWidth={width}
      compositionHeight={height}
      controls
      clickToPlay
      doubleClickToFullscreen
      acknowledgeRemotionLicense
      style={{
        width: "100%",
        aspectRatio: `${width} / ${height}`,
        // A vertical Short at full column width would be taller than the screen.
        ...(shorts ? { maxWidth: 360, margin: "0 auto" } : {}),
        borderRadius: 6,
        overflow: "hidden",
      }}
    />
  );
}
