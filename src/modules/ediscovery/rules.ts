/** kv key holding a matter's coding rules / protocol text (markdown). Client-safe. */
export const CODING_RULES_KEY = (matterId: string) => `ediscovery:rules:${matterId}`;

export const DEFAULT_CODING_RULES: Record<string, string> = {
  default: `# Coding protocol
No protocol has been written for this matter yet. Describe responsiveness criteria, privilege rules, hot-document guidance and issue-code definitions here; reviewers see this text in the Codes & privilege tab and the AI batch predictor uses it as its rubric.`,
};
