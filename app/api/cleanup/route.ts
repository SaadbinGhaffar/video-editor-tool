import { del, list } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGE_MS = 24 * 3600_000;

/**
 * Daily cron (vercel.json): delete uploads and rendered videos older than
 * 24 h from Vercel Blob so storage doesn't grow forever.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const cutoff = Date.now() - MAX_AGE_MS;
  let deleted = 0;
  for (const prefix of ["uploads/", "renders/"]) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      const old = page.blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff).map((b) => b.url);
      if (old.length) await del(old);
      deleted += old.length;
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  return Response.json({ deleted });
}
