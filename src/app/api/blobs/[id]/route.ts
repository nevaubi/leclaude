import { NextRequest } from "next/server";
import { blobs } from "@/lib/db";
import { parseRange } from "@/lib/http-range";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = blobs.get(id);
  if (!b) return new Response("Not found", { status: 404 });
  const base: Record<string, string> = {
    "Content-Type": b.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    ...(b.name ? { "Content-Disposition": `inline; filename="${encodeURIComponent(b.name)}"` } : {}),
  };
  const range = parseRange(req.headers.get("range"), b.size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${b.size}` } });
  if (range) {
    const chunk = b.bytes.subarray(range.start, range.end + 1);
    return new Response(chunk as unknown as BodyInit, { status: 206, headers: { ...base, "Content-Length": String(chunk.byteLength), "Content-Range": `bytes ${range.start}-${range.end}/${b.size}` } });
  }
  return new Response(b.bytes as unknown as BodyInit, { headers: { ...base, "Content-Length": String(b.size) } });
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = await GET(req, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
