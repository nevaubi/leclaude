import { pdfAgentHandler } from "@/modules/office/pdf/agent";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromBody } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Streams the PDF agent (SSE). Body: OfficeAgentRequestBody with a PdfSnapshot. */

export const POST = withAuth(pdfAgentHandler, { action: "read", resource: officeDocFromBody });
