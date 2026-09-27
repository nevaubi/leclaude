import { withDb } from "@/lib/db/request";
import { slidesAgentHandler } from "@/modules/office/slides/agent";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromBody } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Streams the PowerPoint deck agent (SSE). Body: OfficeAgentRequestBody with a SlidesSnapshot. */

export const POST = withDb(withAuth(slidesAgentHandler, { action: "read", resource: officeDocFromBody }));
