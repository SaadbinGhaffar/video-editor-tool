import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { RENDERS_DIR } from "@/lib/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next only serves files that were in /public at build time, so finished
// renders are streamed from here (with Range support for the preview player).
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[0-9a-f-]{36}\.mp4$/.test(file)) return new Response("Not found", { status: 404 });
  const filePath = path.join(RENDERS_DIR, file);
  if (!fs.existsSync(filePath)) return new Response("This video has expired or doesn't exist.", { status: 404 });

  const size = fs.statSync(filePath).size;
  const download = new URL(req.url).searchParams.has("download");
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="narrated-video-${file.slice(0, 8)}.mp4"`;

  const range = req.headers.get("range");
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (match) {
    let start = match[1] ? Number(match[1]) : size - Number(match[2]);
    let end = match[1] && match[2] ? Number(match[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const body = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const body = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
}
