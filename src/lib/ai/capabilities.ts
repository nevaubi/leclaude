/**
 * Coded provider capability matrix (constitution §53.5). Routing consults this registry;
 * an unavailable capability fails closed with InferenceError("capability_unavailable").
 * Client-safe.
 */
import type { CapabilityProfile, ProviderId } from "./providers/types";

const NONE: CapabilityProfile = {
  messages: false, streaming: false, thinking: false, promptCaching: false, citations: false, searchResultBlocks: false,
  filesApi: false, serverWebSearch: false, serverWebFetch: false, codeExecution: false, browserToolset: false, computerUse: false,
  memoryTool: false, textEditorTool: false, bashTool: false, mcpConnector: false, programmaticToolCalling: false, agentSkills: false,
  embeddings: false, imageGeneration: false, vision: false, structuredOutput: false, strictTools: false, toolUseExamples: false,
  deferredTools: false, previousResponseId: false,
};

/** Anthropic first-party Messages API. */
export const ANTHROPIC_CAPABILITIES: CapabilityProfile = {
  ...NONE,
  messages: true, streaming: true, thinking: true, promptCaching: true, citations: true, searchResultBlocks: true,
  filesApi: true, serverWebSearch: true, serverWebFetch: true, codeExecution: true, browserToolset: true, computerUse: true,
  memoryTool: true, textEditorTool: true, bashTool: true, mcpConnector: true, programmaticToolCalling: true, agentSkills: true,
  vision: true, structuredOutput: true, strictTools: true, toolUseExamples: true, deferredTools: true,
};

/**
 * Amazon Bedrock (Anthropic models through InvokeModel / InvokeModelWithResponseStream).
 * Files API, server web tools, code execution, the new browser toolset, MCP connector, programmatic
 * tool calling and agent skills are not Bedrock features; use AgentCore or application code instead.
 * Computer use exists as a version-specific beta and is off until the adapter confirms the deployed version.
 */
export const BEDROCK_CAPABILITIES: CapabilityProfile = {
  ...NONE,
  messages: true, streaming: true, thinking: true, promptCaching: true, citations: true, searchResultBlocks: true,
  textEditorTool: true, bashTool: true, embeddings: true, vision: true, structuredOutput: true, strictTools: false, toolUseExamples: false,
};

/** OpenAI Responses API. Citations here are web-search URL annotations only, not evidence-block citations. */
export const OPENAI_CAPABILITIES: CapabilityProfile = {
  ...NONE,
  messages: true, streaming: true, thinking: true, promptCaching: true, filesApi: true, serverWebSearch: true, codeExecution: true,
  computerUse: true, mcpConnector: true, embeddings: true, imageGeneration: true, vision: true, structuredOutput: true, strictTools: true,
  previousResponseId: true,
};

/** OpenRouter (OpenAI-compatible chat completions). Used only as the external fast router (constitution §16). */
export const OPENROUTER_CAPABILITIES: CapabilityProfile = {
  ...NONE,
  messages: true, streaming: true, structuredOutput: true, vision: true,
};

export const CAPABILITIES: Record<ProviderId, CapabilityProfile> = {
  anthropic: ANTHROPIC_CAPABILITIES,
  bedrock: BEDROCK_CAPABILITIES,
  openai: OPENAI_CAPABILITIES,
  openrouter: OPENROUTER_CAPABILITIES,
};

/** True when every requested capability is present. */
export function satisfies(profile: CapabilityProfile, needs: Partial<CapabilityProfile> | undefined): boolean {
  if (!needs) return true;
  for (const [k, v] of Object.entries(needs)) if (v && !profile[k as keyof CapabilityProfile]) return false;
  return true;
}

/** Names of the capabilities in `needs` that `profile` lacks. */
export function missingCapabilities(profile: CapabilityProfile, needs: Partial<CapabilityProfile> | undefined): (keyof CapabilityProfile)[] {
  if (!needs) return [];
  return (Object.entries(needs) as [keyof CapabilityProfile, boolean | undefined][]).filter(([k, v]) => v && !profile[k]).map(([k]) => k);
}
