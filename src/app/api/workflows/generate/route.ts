import { bootstrap, errorResponse, parseBody } from "@/modules/workflows/api-utils";
import { generateWorkflowDraft } from "@/modules/workflows/generate";
import { generateRequestSchema } from "@/modules/workflows/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST /api/workflows/generate { description, category?, matterId? } → validated draft (nodes/edges/inputs) for the builder. */
export async function POST(req: Request) {
  bootstrap();
  const body = await parseBody(req, generateRequestSchema);
  if (!body.ok) return body.res;
  try {
    const draft = await generateWorkflowDraft(body.data.description, { category: body.data.category, matterId: body.data.matterId, signal: req.signal });
    return Response.json({ draft });
  } catch (e) { return errorResponse(e); }
}
