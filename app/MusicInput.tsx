"use client";

import { useEffect, useState } from "react";

export type MusicChoice = { file: File; url: string; duration: number | null };

/** Optional background music: pick a clip, hear it, set its level. */
export function MusicInput({
  music,
  volume,
  onChange,
  onVolume,
  videoDuration,
  disabled,
}: {
  music: MusicChoice | null;
  volume: number;
  onChange: (m: MusicChoice | null) => void;
  onVolume: (v: number) => void;
  /** Length of the finished video, when known (after a preview). */
  videoDuration: number | null;
  disabled: boolean;
}) {
  const [inputKey, setInputKey] = useState(0);

  // Read the clip's length so we can say whether it will loop.
  useEffect(() => {
    if (!music || music.duration !== null) return;
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => onChange({ ...music, duration: Number.isFinite(a.duration) ? a.duration : null });
    a.src = music.url;
  }, [music, onChange]);

  const choose = (file: File | null) => {
    if (music) URL.revokeObjectURL(music.url);
    onChange(file ? { file, url: URL.createObjectURL(file), duration: null } : null);
  };

  let note = "Loops under the narration for the whole video, fades in and out, and dips automatically while you speak.";
  if (music?.duration) {
    const d = music.duration;
    if (d < 30 || d > 60) note = `This clip is ${d.toFixed(0)} s. A 30–60 s clip works best; it will still ${d < 30 ? "loop" : "be trimmed"} to fit.`;
    else if (videoDuration) note = videoDuration > d ? `Loops ${Math.ceil(videoDuration / d)}× to cover the ${videoDuration.toFixed(0)} s video.` : "Covers the whole video.";
  }

  return (
    <div className="music">
      <input
        key={inputKey}
        id="music"
        type="file"
        accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a"
        onChange={(e) => choose(e.target.files?.[0] ?? null)}
        disabled={disabled}
      />
      {music ? (
        <div className="music-controls">
          <audio src={music.url} controls preload="metadata" />
          <label className="volume">
            <span>Music level {Math.round(volume * 100)}%</span>
            <input
              type="range"
              min={0.05}
              max={0.8}
              step={0.05}
              value={volume}
              onChange={(e) => onVolume(Number(e.target.value))}
              disabled={disabled}
            />
          </label>
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              choose(null);
              setInputKey((k) => k + 1);
            }}
            disabled={disabled}
          >
            Remove music
          </button>
        </div>
      ) : null}
      <p className="hint">{note}</p>
    </div>
  );
}
