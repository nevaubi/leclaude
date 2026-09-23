import { createUpdate, listUpdates } from "@/modules/home/service";
import { updateCreateSchema } from "@/modules/home/schemas";
import { param, parseBody } from "@/modules/home/api-utils";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return Response.json({ updates: listUpdates({ matterId: param(url, "matter"), limit: Number(url.searchParams.get("limit") ?? 60) || 60 }) });
}

export async function POST(req: Request) {
  const body = await parseBody(req, updateCreateSchema);
  if (!body.ok) return body.res;
  return Response.json({ update: createUpdate(body.data) }, { status: 201 });
}
