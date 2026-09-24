import "server-only";
import { AIConfigError } from "./config";
import { getRegistry } from "./providers/registry";
import { InferenceError } from "./providers/types";
import { routeModel } from "./router";
import { blobs } from "@/lib/db/blobs";

/**
 * Generate an image with the configured image provider (image role; OpenAI today) and store it as a blob.
 * Returns the blob id and a same-origin URL usable in <img> and in DOCX/PPTX exports.
 */
export async function generateImage(prompt: string, opts: { size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto"; quality?: "low" | "medium" | "high" | "auto"; signal?: AbortSignal; name?: string } = {}) {
  const reg = getRegistry();
  let decision;
  try {
    decision = routeModel({ taskType: "image", role: "image", privacy: "internal" }, { available: reg.models, preferred: reg.preferred, allowExternalForMatterData: reg.allowExternalForMatterData });
  } catch (e) {
    if (e instanceof InferenceError && (e.code === "not_configured" || e.code === "capability_unavailable")) throw new AIConfigError(`Image generation is not configured (${e.message})`);
    throw e;
  }
  const provider = reg.providers.get(decision.provider);
  if (!provider?.generateImage) throw new AIConfigError(`Provider ${decision.provider} cannot generate images.`);
  const img = await provider.generateImage(prompt, { size: opts.size ?? "1024x1024", quality: opts.quality ?? "medium", signal: opts.signal });
  const rec = blobs.put(img.bytes, img.mime, { name: opts.name ?? `generated-${Date.now()}.png`, meta: { prompt, model: img.model } });
  return { blobId: rec.id, url: `/api/blobs/${rec.id}`, size: rec.size, model: img.model };
}
