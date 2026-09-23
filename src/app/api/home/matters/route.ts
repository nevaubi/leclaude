import { matterOverview } from "@/modules/home/service";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ matters: matterOverview() });
}
