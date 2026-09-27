import { slidesAgentHandler } from "@/modules/office/slides/agent";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromBody } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Streams the PowerPoint deck agent (SSE). Body: OfficeAgentRequestBody with a SlidesSnapshot. */

export const POST = withAuth(slidesAgentHandler, { action: "read", resource: officeDocFromBody });
