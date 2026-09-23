import { NextRequest } from "next/server";
import { allTemplates } from "@/modules/office/shared/template-registry";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const templates = allTemplates().filter((t) => !kind || t.kind === kind).map(({ build: _b, ...rest }) => { void _b; return rest; });
  return Response.json({ templates });
}
