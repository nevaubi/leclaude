import { wordAgentHandler } from "@/modules/office/word/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Streams the Word drafting agent (SSE). Body: OfficeAgentRequestBody with a WordSnapshot. */
export const POST = wordAgentHandler;
