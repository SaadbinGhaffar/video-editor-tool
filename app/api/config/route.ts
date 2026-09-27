import { accessKeyRequired } from "@/lib/access";
import { deployMode } from "@/lib/deploy";
import { aiProvider } from "@/lib/llm";
import { maxVideoSeconds, SANDBOX_BUDGET } from "@/lib/renderBudget";

export const dynamic = "force-dynamic";

/** Tells the page how to upload (direct-to-Blob on Vercel, multipart locally) and how long a video can be. */
export function GET() {
  const vercel = deployMode === "vercel";
  return Response.json({
    mode: deployMode,
    accessKeyRequired,
    blobConfigured: !!process.env.BLOB_READ_WRITE_TOKEN,
    transcriptionConfigured: deployMode === "local" || !!aiProvider(),
    renderBudget: vercel ? SANDBOX_BUDGET : null,
    maxVideoSeconds: vercel ? maxVideoSeconds(SANDBOX_BUDGET) : null,
  });
}
