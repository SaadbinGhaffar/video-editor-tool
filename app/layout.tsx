import type { Metadata } from "next";
import { GOOGLE_FONTS_CSS } from "@/lib/captionLooks";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auto Video Editor",
  description: "Narration + transcript + images → captioned 1080p MP4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Caption fonts, so the style picker shows each font for real. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={GOOGLE_FONTS_CSS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
