import { denyWithoutAccess } from "@/lib/access";
import { checkTranscript, parseNiche } from "@/lib/pipeline";
import { writeSeo } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** YouTube title, description and tags for a finished video, from its transcript. */
export async function POST(req: Request) {
  const denied = denyWithoutAccess(req);
  if (denied) return denied;
  let body: { transcript?: unknown; niche?: unknown; durationInSeconds?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ type: "error", message: "The request couldn't be read." }, { status: 400 });
  }
  const transcript = String(body.transcript ?? "").trim();
  const problem = checkTranscript(transcript);
  if (problem) return Response.json({ type: "error", message: problem }, { status: 400 });
  const duration = Number(body.durationInSeconds);
  return Response.json(
    await writeSeo(transcript, parseNiche(body.niche) ?? "general", Number.isFinite(duration) && duration > 0 ? duration : 0),
  );
}
