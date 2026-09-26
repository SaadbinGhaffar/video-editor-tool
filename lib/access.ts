import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Optional shared access key. When APP_ACCESS_KEY is set, every API call must
 * send it (header `x-access-key`), so a public deployment can't be used by
 * strangers to run renders and transcriptions on your accounts.
 */
export const accessKeyRequired = !!process.env.APP_ACCESS_KEY;

export function checkAccessKey(provided: string | null | undefined): boolean {
  const expected = process.env.APP_ACCESS_KEY;
  if (!expected) return true;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns a 401 response if the request lacks the access key, otherwise null. */
export function denyWithoutAccess(req: Request): Response | null {
  if (checkAccessKey(req.headers.get("x-access-key"))) return null;
  return Response.json({ type: "error", message: "Wrong or missing access key.", code: "access" }, { status: 401 });
}
