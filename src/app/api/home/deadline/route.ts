import { computeDeadline, DEADLINE_PRESETS, federalHolidays } from "@/modules/home/deadline";
import { deadlineSchema } from "@/modules/home/schemas";
import { parseBody } from "@/modules/home/api-utils";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
  return Response.json({ presets: DEADLINE_PRESETS, holidays: federalHolidays(Number.isFinite(year) ? year : new Date().getFullYear()) });
}

export async function POST(req: Request) {
  const body = await parseBody(req, deadlineSchema);
  if (!body.ok) return body.res;
  return Response.json({ result: computeDeadline(body.data) });
}
