"use client";

import { useCallback, useEffect, useState } from "react";
import type { NicheId, SeoPack, VideoFormat } from "@/lib/types";
import { accessHeaders } from "./transport";

/**
 * YouTube title, description and tags for the finished video, written from
 * its transcript. Each field is editable and has its own copy button.
 */
export function SeoPanel({
  transcript,
  niche,
  durationInSeconds,
  format,
  accessKey,
}: {
  transcript: string;
  niche: NicheId;
  durationInSeconds: number;
  format: VideoFormat;
  accessKey: string;
}) {
  const [seo, setSeo] = useState<SeoPack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/seo", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...accessHeaders(accessKey) },
        body: JSON.stringify({ transcript, niche, durationInSeconds, format }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.title) throw new Error(data?.message ?? `The server returned an error (${res.status}).`);
      setSeo(data as SeoPack);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [transcript, niche, durationInSeconds, format, accessKey]);

  useEffect(() => {
    load();
  }, [load]);

  const tags = seo?.tags.join(", ") ?? "";

  return (
    <div className="seo">
      <h3>{format === "shorts" ? "YouTube Shorts" : "YouTube"} title &amp; description</h3>
      {loading && !seo ? <p className="hint">Writing an SEO title and description from your transcript…</p> : null}
      {error ? (
        <div className="error" role="alert">
          {error}{" "}
          <button type="button" className="secondary small" onClick={load}>
            Try again
          </button>
        </div>
      ) : null}
      {seo ? (
        <>
          <SeoField
            label="Title"
            value={seo.title}
            onChange={(title) => setSeo({ ...seo, title })}
            note={`${seo.title.length}/100 characters · keep the key phrase in the first 60`}
          />
          <SeoField
            label="Description"
            value={seo.description}
            onChange={(description) => setSeo({ ...seo, description })}
            multiline
            note={`${seo.description.split(/\s+/).filter(Boolean).length} words`}
          />
          <SeoField
            label="Tags"
            value={tags}
            onChange={(v) => setSeo({ ...seo, tags: v.split(",").map((t) => t.trim()).filter(Boolean) })}
            note={`${tags.length}/500 characters · paste into YouTube Studio's Tags box`}
          />
          <p className="hint">
            {seo.source === "llm"
              ? "Written by AI from your transcript. Edit anything before copying."
              : "Basic version made from your transcript. Add a GROQ_API_KEY or OPENAI_API_KEY for AI-written, keyword-optimised text."}{" "}
            <button type="button" className="secondary small" onClick={load} disabled={loading}>
              {loading ? "Writing…" : "Write another version"}
            </button>
          </p>
        </>
      ) : null}
    </div>
  );
}

function SeoField({
  label,
  value,
  onChange,
  note,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  note: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const id = `seo-${label.toLowerCase()}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. insecure context): the text can still be selected by hand.
    }
  };
  return (
    <div className="seo-field">
      <div className="seo-field-head">
        <label htmlFor={id}>{label}</label>
        <button type="button" className="secondary small" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {multiline ? (
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={12} />
      ) : (
        <input id={id} className="text" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      <span className="meta">{note}</span>
    </div>
  );
}
