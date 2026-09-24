/** Pure: read a well-formed `provenance` (or `aiProvenance`) field off any record, else undefined. */
import type { Provenance } from "@/lib/integrity/types";

export function provenanceOf(record: unknown): Provenance | undefined {
  if (!record || typeof record !== "object") return undefined;
  const p = (record as { provenance?: unknown }).provenance ?? (record as { aiProvenance?: unknown }).aiProvenance;
  if (!p || typeof p !== "object") return undefined;
  const v = p as Partial<Provenance>;
  return typeof v.model === "string" && typeof v.generatedAt === "string" && Array.isArray(v.sources) ? (v as Provenance) : undefined;
}
