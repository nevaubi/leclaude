import { bootstrap } from "@/modules/workflows/api-utils";
import { workflowStats } from "@/modules/workflows/service";

export const runtime = "nodejs";

export async function GET() {
  bootstrap();
  return Response.json({ stats: workflowStats() });
}
