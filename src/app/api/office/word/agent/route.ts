import { wordAgentHandler } from "@/modules/office/word/agent";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromBody } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Streams the Word drafting agent (SSE). Body: OfficeAgentRequestBody with a WordSnapshot. */

export const POST = withAuth(wordAgentHandler, { action: "read", resource: officeDocFromBody });
