import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { checkAccessKey } from "@/lib/access";

export const runtime = "nodejs";

/**
 * Issues short-lived tokens so the browser can upload audio and images
 * straight to Vercel Blob (Vercel Functions only accept ~4.5 MB bodies).
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!checkAccessKey(clientPayload)) throw new Error("Wrong or missing access key.");
        if (!pathname.startsWith("uploads/")) throw new Error("Invalid upload path.");
        return {
          allowedContentTypes: [
            "audio/mpeg",
            "audio/mp3",
            "audio/wav",
            "audio/x-wav",
            "audio/wave",
            "audio/mp4",
            "audio/x-m4a",
            "audio/aac",
            "image/jpeg",
            "image/png",
            "image/webp",
          ],
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Upload failed." }, { status: 400 });
  }
}
