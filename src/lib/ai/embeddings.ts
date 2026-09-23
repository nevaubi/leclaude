import "server-only";
import { getOpenAI } from "./openai";
import { aiConfig } from "./config";

const BATCH = 96;

export async function embedTexts(texts: string[], opts: { model?: string; signal?: AbortSignal } = {}): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const client = getOpenAI();
  const model = opts.model ?? aiConfig().embeddingModel;
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH).map((t) => t.slice(0, 24_000));
    const res = await client.embeddings.create({ model, input: slice, encoding_format: "float" }, { signal: opts.signal });
    for (const d of res.data) out.push(Float32Array.from(d.embedding));
  }
  return out;
}

export async function embedText(text: string, opts: { model?: string; signal?: AbortSignal } = {}) {
  return (await embedTexts([text], opts))[0];
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Sentence-aware chunking with overlap; sizes are in characters (~4 chars per token). */
export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = opts.size ?? 1600;
  const overlap = opts.overlap ?? 200;
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const sentences = clean.split(/(?<=[.!?])\s+|\n{2,}/);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).length > size && cur) {
      chunks.push(cur.trim());
      cur = cur.slice(Math.max(0, cur.length - overlap)) + " " + s;
    } else {
      cur += (cur ? " " : "") + s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export function float32ToBuffer(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

export function bufferToFloat32(b: Uint8Array): Float32Array {
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer);
}
