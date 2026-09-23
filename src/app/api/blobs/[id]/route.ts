import { NextRequest } from "next/server";
import { blobs } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = blobs.get(id);
  if (!b) return new Response("Not found", { status: 404 });
  return new Response(b.bytes as unknown as BodyInit, { headers: { "Content-Type": b.mime, "Content-Length": String(b.size), "Cache-Control": "private, max-age=3600", ...(b.name ? { "Content-Disposition": `inline; filename="${encodeURIComponent(b.name)}"` } : {}) } });
}
