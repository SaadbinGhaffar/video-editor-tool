import { getRenderProgress } from "@remotion/vercel";
import { denyWithoutAccess } from "@/lib/access";
import { renderMachineStopped, stopSandbox } from "@/lib/sandbox-render";
import type { RenderStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polled by the page while a detached Vercel Sandbox render runs. */
export async function GET(req: Request) {
  const denied = denyWithoutAccess(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const sandboxId = params.get("sandboxId");
  const cmdId = params.get("cmdId");
  if (!sandboxId || !cmdId || !/^[\w-]+$/.test(sandboxId) || !/^[\w-]+$/.test(cmdId)) {
    return Response.json({ state: "error", message: "Missing render id." } satisfies RenderStatus, { status: 400 });
  }

  const p = await getRenderProgress({ sandboxId, cmdId });
  let status: RenderStatus;
  switch (p.stage) {
    case "done": {
      const download = new URL(p.url);
      download.searchParams.set("download", "1");
      status = { state: "done", url: p.url, downloadUrl: download.toString(), size: p.size };
      break;
    }
    case "error":
      console.error("[render-progress]", p.message);
      status = { state: "error", message: "The render failed. Check the function logs for details and try again." };
      break;
    case "expired":
      status = { state: "error", message: "The render machine stopped before the video finished. Please try again." };
      break;
    case "render-progress":
      status = { state: "running", message: "Rendering video…", progress: p.overallProgress };
      break;
    case "uploading":
      status = { state: "running", message: "Saving the MP4…", progress: p.overallProgress };
      break;
    default:
      status = { state: "running", message: "Starting the renderer…", progress: p.overallProgress };
  }
  if (status.state === "running" && (await renderMachineStopped(sandboxId))) {
    status = {
      state: "error",
      message:
        "The render machine hit its time limit before the video finished. Try a shorter narration or no video effect.",
    };
  }
  if (status.state !== "running") await stopSandbox(sandboxId);
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
