import { accessKeyRequired } from "@/lib/access";
import { deployMode } from "@/lib/deploy";

export const dynamic = "force-dynamic";

/** Tells the page how to upload (direct-to-Blob on Vercel, multipart locally). */
export function GET() {
  return Response.json({
    mode: deployMode,
    accessKeyRequired,
    blobConfigured: !!process.env.BLOB_READ_WRITE_TOKEN,
    transcriptionConfigured: deployMode === "local" || !!process.env.OPENAI_API_KEY,
  });
}
