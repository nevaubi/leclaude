import type { ZodType } from "zod";
import { jsonError } from "@/lib/ai/sse";

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return { ok: false, res: jsonError("Invalid JSON body") }; }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, res: jsonError("Validation failed", 400, { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }) };
  return { ok: true, data: parsed.data };
}

export function param(url: URL, key: string): string | null {
  const v = url.searchParams.get(key);
  return v && v.trim() ? v.trim() : null;
}
