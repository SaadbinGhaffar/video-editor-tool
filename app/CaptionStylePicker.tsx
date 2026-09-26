"use client";

import { CAPTION_LOOKS, CRISP_TEXT, FONTS, type CaptionLook } from "@/lib/captionLooks";
import { CAPTION_STYLES, type CaptionStyleId } from "@/lib/types";

/**
 * Caption style chooser: each option is a live sample drawn in its real font,
 * colours, outline and highlight, labelled with the font name.
 */
export function CaptionStylePicker({
  value,
  autoStyle,
  onChange,
  disabled,
}: {
  value: CaptionStyleId | "auto";
  /** The style "auto" resolves to for the current niche. */
  autoStyle: CaptionStyleId;
  onChange: (v: CaptionStyleId | "auto") => void;
  disabled: boolean;
}) {
  const options: { id: CaptionStyleId | "auto"; look: CaptionLook; title: string }[] = [
    { id: "auto", look: CAPTION_LOOKS[autoStyle], title: `Match style (${CAPTION_LOOKS[autoStyle].label})` },
    ...CAPTION_STYLES.map((id) => ({ id, look: CAPTION_LOOKS[id], title: CAPTION_LOOKS[id].label })),
  ];
  return (
    <div className="caption-picker" role="radiogroup" aria-label="Caption style">
      {options.map(({ id, look, title }) => (
        <button
          type="button"
          key={id}
          role="radio"
          aria-checked={value === id}
          className={`caption-card${value === id ? " selected" : ""}`}
          onClick={() => onChange(id)}
          disabled={disabled}
        >
          <span className="caption-sample">
            <Sample look={look} />
          </span>
          <span className="caption-meta">
            <strong>{title}</strong>
            <span style={{ fontFamily: `"${FONTS[look.font].family}", sans-serif`, fontWeight: FONTS[look.font].weight }}>
              {FONTS[look.font].label}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Sample({ look }: { look: CaptionLook }) {
  const font = FONTS[look.font];
  // Scaled down from the 1080p sizes so every sample fits its card at the video's proportions.
  const scale = 5.4;
  const size = Math.round(look.size / scale);
  const stroke = look.stroke
    ? { WebkitTextStroke: `${Math.max(2, look.stroke / scale)}px black`, paintOrder: "stroke fill" as const }
    : {};
  const word = (text: string, active: boolean) => (
    <span
      style={{
        display: "inline-block",
        margin: "0 0.04em",
        color: active ? (look.mode === "box" ? (look.boxText ?? "#fff") : look.highlight) : look.color,
        ...(active && look.mode === "box"
          ? { background: look.highlight, borderRadius: "0.18em", padding: "0 0.12em" }
          : stroke),
      }}
    >
      {text}
    </span>
  );
  return (
    <span
      style={{
        fontFamily: `"${font.family}", "Arial Black", sans-serif`,
        fontWeight: font.weight,
        fontSize: size,
        lineHeight: 1.1,
        textTransform: look.uppercase ? "uppercase" : "none",
        letterSpacing: look.letterSpacing,
        textShadow: look.stroke ? "0 2px 6px rgba(0,0,0,0.5)" : undefined,
        whiteSpace: "nowrap",
        ...CRISP_TEXT,
        ...(look.panel ? { background: "rgba(10,12,20,0.72)", borderRadius: 8, padding: "2px 8px 4px" } : {}),
      }}
    >
      {word("Your", false)} {word("caption", true)} {word("here", false)}
    </span>
  );
}
