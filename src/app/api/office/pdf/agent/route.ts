import { pdfAgentHandler } from "@/modules/office/pdf/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Streams the PDF agent (SSE). Body: OfficeAgentRequestBody with a PdfSnapshot. */
export const POST = pdfAgentHandler;
