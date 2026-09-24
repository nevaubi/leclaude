import { sheetAgentHandler } from "@/modules/office/sheet/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Streams the spreadsheet agent (SSE). Body: OfficeAgentRequestBody with a SheetSnapshot. */
export const POST = sheetAgentHandler;
