import { withDb } from "@/lib/db/request";
import { computeDeadline, DEADLINE_PRESETS, federalHolidays } from "@/modules/home/deadline";
import { deadlineSchema } from "@/modules/home/schemas";
import { parseBody } from "@/modules/home/api-utils";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
  return Response.json({ presets: DEADLINE_PRESETS, holidays: federalHolidays(Number.isFinite(year) ? year : new Date().getFullYear()) });
}

async function handlePOST(req: Request) {
  const body = await parseBody(req, deadlineSchema);
  if (!body.ok) return body.res;
  return Response.json({ result: computeDeadline(body.data) });
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: () => ({ kind: "event" }) }));
export const POST = withDb(withAuth(handlePOST, { action: "read", resource: () => ({ kind: "event" }) }));
