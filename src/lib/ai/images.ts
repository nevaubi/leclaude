import "server-only";
import { getOpenAI } from "./openai";
import { aiConfig } from "./config";
import { blobs } from "@/lib/db/blobs";

/**
 * Generate an image with the configured OpenAI image model and store it as a blob.
 * Returns the blob id and a same-origin URL usable in <img> and in DOCX/PPTX exports.
 */
export async function generateImage(prompt: string, opts: { size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto"; quality?: "low" | "medium" | "high" | "auto"; signal?: AbortSignal; name?: string } = {}) {
  const client = getOpenAI();
  const model = aiConfig().imageModel;
  const res = await client.images.generate({ model, prompt: prompt.slice(0, 4000), size: opts.size ?? "1024x1024", quality: opts.quality ?? "medium", n: 1 }, { signal: opts.signal });
  const item = res.data?.[0];
  if (!item?.b64_json) throw new Error("Image generation returned no image data");
  const bytes = Uint8Array.from(Buffer.from(item.b64_json, "base64"));
  const rec = blobs.put(bytes, "image/png", { name: opts.name ?? `generated-${Date.now()}.png`, meta: { prompt, model } });
  return { blobId: rec.id, url: `/api/blobs/${rec.id}`, size: rec.size, model };
}
