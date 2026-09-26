import { Composition } from "remotion";
import { planStyle, buildVideoProps } from "../lib/style";
import { FPS, VIDEO_HEIGHT, VIDEO_WIDTH, type MainVideoProps, type Timing } from "../lib/types";
import { MainVideo } from "./MainVideo";

// Sample props so `npm run remotion:studio` shows something without the upload
// flow. Change `niche` to preview another style.
const sampleTiming: Timing = {
  durationInSeconds: 8,
  audioOffset: 0,
  words: 8,
  wpm: 150,
  provider: "sample",
  detected: { niche: "travel", confidence: 1, signals: [], source: "keywords" },
  scenes: [
    { start: 0, end: 2.7 },
    { start: 2.7, end: 5.4 },
    { start: 5.4, end: 8 },
  ],
  cues: [
    {
      start: 0.2,
      end: 2.4,
      words: [
        { text: "This", start: 0.2, end: 0.6 },
        { text: "is", start: 0.6, end: 0.9 },
        { text: "a", start: 0.9, end: 1.1 },
        { text: "preview.", start: 1.1, end: 2 },
      ],
    },
    {
      start: 2.8,
      end: 6,
      words: [
        { text: "Captions", start: 2.8, end: 3.5 },
        { text: "look", start: 3.5, end: 4 },
        { text: "like", start: 4, end: 4.4 },
        { text: "this.", start: 4.4, end: 5.2 },
      ],
    },
  ],
};

const defaultProps: MainVideoProps = buildVideoProps(
  sampleTiming,
  planStyle({ niche: "travel", timing: sampleTiming, imageStats: [null, null, null] }),
  "",
  [
    "https://picsum.photos/id/1018/1920/1080",
    "https://picsum.photos/id/1015/1920/1080",
    "https://picsum.photos/id/1036/1920/1080",
  ],
);

export const RemotionRoot: React.FC = () => (
  <Composition
    id="MainVideo"
    component={MainVideo}
    width={VIDEO_WIDTH}
    height={VIDEO_HEIGHT}
    fps={FPS}
    durationInFrames={Math.ceil(defaultProps.durationInSeconds * FPS)}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, Math.ceil(props.durationInSeconds * FPS)),
    })}
  />
);
