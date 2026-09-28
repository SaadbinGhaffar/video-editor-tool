"use client";

import { useRef, useState } from "react";
import { needsBlurFill } from "@/lib/style";
import { MAX_IMAGES, type ImageStats, type VideoFormat } from "@/lib/types";

export type ImageItem = { id: number; file: File; url: string; stats: ImageStats | null };

/** Multi-image picker: drop or browse to add, drag or use the arrows to reorder. */
export function ImageGallery({
  format,
  images,
  onAdd,
  onRemove,
  onReorder,
  disabled,
}: {
  format: VideoFormat;
  images: ImageItem[];
  onAdd: (files: File[]) => void;
  onRemove: (id: number) => void;
  onReorder: (next: ImageItem[]) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const full = images.length >= MAX_IMAGES;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length) return;
    const next = [...images];
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
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          aria-label="Add images"
          className="visually-hidden"
          onChange={(e) => {
            onAdd([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
          disabled={disabled || full}
        />
        <button type="button" className="secondary small" onClick={() => input.current?.click()} disabled={disabled || full}>
          {images.length ? "Add more images" : "Choose images"}
        </button>
        <span className="hint">
          {full
            ? `${MAX_IMAGES} of ${MAX_IMAGES} images added.`
            : `or drop them here · ${images.length} of ${MAX_IMAGES} · JPG, PNG or WebP`}
        </span>
      </div>

      {images.length ? (
        <ol className="gallery">
          {images.map((img, i) => (
            <li
              key={img.id}
              className={`tile${dragId === img.id ? " dragging" : ""}`}
              draggable={!disabled}
              onDragStart={(e) => {
                setDragId(img.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                const from = images.findIndex((x) => x.id === dragId);
                if (from !== i) move(from, i);
              }}
            >
              <div className="tile-thumb" style={{ backgroundImage: `url(${img.url})` }}>
                <span className="tile-num">{i + 1}</span>
                {img.stats && needsBlurFill(img.stats.aspect, format) ? <span className="tile-tag">fit</span> : null}
              </div>
              <div className="tile-actions">
                <button type="button" aria-label={`Move image ${i + 1} earlier`} onClick={() => move(i, i - 1)} disabled={disabled || i === 0}>
                  ←
                </button>
                <button type="button" aria-label={`Remove image ${i + 1}`} onClick={() => onRemove(img.id)} disabled={disabled}>
                  ✕
                </button>
                <button
                  type="button"
                  aria-label={`Move image ${i + 1} later`}
                  onClick={() => move(i, i + 1)}
                  disabled={disabled || i === images.length - 1}
                >
                  →
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="hint">
        Images play in this order, spread across the narration with cuts on sentence breaks.{" "}
        {format === "shorts" ? "Landscape" : "Portrait"} photos (marked “fit”) are shown whole over a blurred backdrop
        instead of being cropped.
      </p>
    </div>
  );
}
