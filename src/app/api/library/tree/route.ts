import { jsonError } from "@/lib/ai/sse";
import { treeResponse } from "@/modules/library/service";

export const runtime = "nodejs";

export async function GET() {
  try { return Response.json(treeResponse()); } catch (e) { return jsonError((e as Error).message, 500); }
}
