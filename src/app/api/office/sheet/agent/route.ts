import { withDb } from "@/lib/db/request";
import { sheetAgentHandler } from "@/modules/office/sheet/agent";
import { withAuth } from "@/lib/auth/route";
import { officeDocFromBody } from "@/modules/office/shared/route-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Streams the spreadsheet agent (SSE). Body: OfficeAgentRequestBody with a SheetSnapshot. */

export const POST = withDb(withAuth(sheetAgentHandler, { action: "read", resource: officeDocFromBody }));
