import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auto Video Editor",
  description: "Narration + transcript + images → captioned 1080p MP4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
