"use client";

import { useRef, useState } from "react";
import { MAX_IMAGES, type ImageStats, type MediaKind } from "@/lib/types";

export type MediaItem = {
  id: number;
  file: File;
  url: string;
  kind: MediaKind;
  stats: ImageStats | null;
  /** Clip length in seconds (null for images, or until measured). */
  duration: number | null;
};

/** Image and clip picker: drop or browse to add, drag or use the arrows to reorder. */
export function MediaGallery({
  items,
  onAdd,
  onRemove,
  onReorder,
  disabled,
}: {
  items: MediaItem[];
  onAdd: (files: File[]) => void;
  onRemove: (id: number) => void;
  onReorder: (next: MediaItem[]) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const full = items.length >= MAX_IMAGES;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onReorder(next);
  };

  return (
    <div>
      <div
        className={`dropzone${dragOver ? " over" : ""}${full ? " full" : ""}`}
        onDragOver={(e) => {
          if (dragId !== null || disabled || full) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false);
          if (dragId !== null || disabled) return;
          e.preventDefault();
          onAdd([...e.dataTransfer.files]);
        }}
      >
        <input
          ref={input}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.m4v,.webm,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          aria-label="Add images or video clips"
          className="visually-hidden"
          onChange={(e) => {
            onAdd([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
          disabled={disabled || full}
        />
        <button type="button" className="secondary small" onClick={() => input.current?.click()} disabled={disabled || full}>
          {items.length ? "Add more" : "Choose images or clips"}
        </button>
        <span className="hint">
          {full
            ? `${MAX_IMAGES} of ${MAX_IMAGES} added.`
            : `or drop them here · ${items.length} of ${MAX_IMAGES} · JPG, PNG, WebP, MP4, MOV or WebM`}
        </span>
      </div>

      {items.length ? (
        <ol className="gallery">
          {items.map((item, i) => (
            <li
              key={item.id}
              className={`tile${dragId === item.id ? " dragging" : ""}`}
              draggable={!disabled}
              onDragStart={(e) => {
                setDragId(item.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                const from = items.findIndex((x) => x.id === dragId);
                if (from !== i) move(from, i);
              }}
            >
              <div
                className="tile-thumb"
                style={item.kind === "image" ? { backgroundImage: `url(${item.url})` } : undefined}
              >
                {item.kind === "video" ? (
                  // "#t=0.5" shows a frame from half a second in instead of a (often black) first frame.
                  <video className="tile-video" src={`${item.url}#t=0.5`} muted playsInline preload="metadata" />
                ) : null}
                <span className="tile-num">{i + 1}</span>
                {item.kind === "video" ? (
                  <span className="tile-tag">▶ {item.duration ? `${item.duration.toFixed(1)} s` : "clip"}</span>
                ) : item.stats && item.stats.aspect < 1.3 ? (
                  <span className="tile-tag">fit</span>
                ) : null}
              </div>
              <div className="tile-actions">
                <button type="button" aria-label={`Move item ${i + 1} earlier`} onClick={() => move(i, i - 1)} disabled={disabled || i === 0}>
                  ←
                </button>
                <button type="button" aria-label={`Remove item ${i + 1}`} onClick={() => onRemove(item.id)} disabled={disabled}>
                  ✕
                </button>
                <button
                  type="button"
                  aria-label={`Move item ${i + 1} later`}
                  onClick={() => move(i, i + 1)}
                  disabled={disabled || i === items.length - 1}
                >
                  →
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="hint">
        They play in this order, spread across the narration with cuts on sentence breaks. Portrait photos (marked
        “fit”) and portrait clips are shown whole over a blurred backdrop. Clips play muted under your voice; one shorter than its
        slot is slowed down a little, then looped. Short 5–10 s clips work best.
      </p>
    </div>
  );
}
