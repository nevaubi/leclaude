import { withDb } from "@/lib/db/request";
import { createUpdate, listUpdates } from "@/modules/home/service";
import { updateCreateSchema } from "@/modules/home/schemas";
import { param, parseBody } from "@/modules/home/api-utils";
import { withAuth } from "@/lib/auth/route";
import { bodyMatterId, queryParam } from "@/lib/auth/resources";

export const runtime = "nodejs";

async function handleGET(req: Request) {
  const url = new URL(req.url);
  return Response.json({ updates: listUpdates({ matterId: param(url, "matter"), limit: Number(url.searchParams.get("limit") ?? 60) || 60 }) });
}

async function handlePOST(req: Request) {
  const body = await parseBody(req, updateCreateSchema);
  if (!body.ok) return body.res;
  return Response.json({ update: createUpdate(body.data) }, { status: 201 });
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (req) => ({ kind: "update", matterId: queryParam(req, "matter") }) }));
export const POST = withDb(withAuth(handlePOST, { action: "write", resource: async (req) => ({ kind: "update", matterId: await bodyMatterId(req) }) }));
