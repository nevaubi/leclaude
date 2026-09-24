import { slidesAgentHandler } from "@/modules/office/slides/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Streams the PowerPoint deck agent (SSE). Body: OfficeAgentRequestBody with a SlidesSnapshot. */
export const POST = slidesAgentHandler;
