import "server-only";
import { remoteUrl } from "./remote";
import { lastSyncError, remoteEnabled, syncDb } from "./sync";
import { dataDir } from "./sqlite";

/** Strip anything that could carry credentials (connection strings, bearer tokens) from an error message shown to users. */
export function safeReason(message: string): string {
  return message
    .replace(/postgres(ql)?:\/\/\S+/gi, "[connection string]")
    .replace(/(password|token|secret|authorization)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 600);
}

export interface Diagnosis {
  ok: boolean;
  serverless: boolean;
  node: string;
  database: { configured: boolean; source: "DATABASE_URL" | "POSTGRES_URL" | null; host: string | null };
  steps: { step: string; ok: boolean; ms: number; error?: string }[];
}

async function step(steps: Diagnosis["steps"], name: string, fn: () => unknown | Promise<unknown>): Promise<boolean> {
  const t = Date.now();
  try {
    await fn();
    steps.push({ step: name, ok: true, ms: Date.now() - t });
    return true;
  } catch (e) {
    steps.push({ step: name, ok: false, ms: Date.now() - t, error: safeReason(`${(e as Error).name}: ${(e as Error).message}${(e as Error & { cause?: Error }).cause ? ` (cause: ${((e as Error & { cause?: Error }).cause as Error).message})` : ""}`) });
    return false;
  }
}

/** Run the storage start-up path step by step and report where it fails (no secrets in the output). */
export async function diagnoseStorage(): Promise<Diagnosis> {
  const url = remoteUrl();
  let host: string | null = null;
  try { host = url ? new URL(url).hostname : null; } catch { host = "unparseable"; }
  const steps: Diagnosis["steps"] = [];
  await step(steps, "local data directory", () => dataDir());
  const sqliteOk = await step(steps, "sqlite (node:sqlite)", async () => { const { db } = await import("./index"); db(); });
  if (sqliteOk && remoteEnabled()) await step(steps, "shared database sync", () => syncDb());
  const prior = lastSyncError();
  if (prior && steps.every((s) => s.ok)) steps.push({ step: "previous sync attempt", ok: false, ms: 0, error: safeReason(prior) });
  if (sqliteOk) await step(steps, "read workspace", async () => { const { getWorkspace } = await import("@/lib/workspace"); getWorkspace(); });
  return {
    ok: steps.every((s) => s.ok),
    serverless: Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME),
    node: process.version,
    database: { configured: Boolean(url), source: process.env.DATABASE_URL?.trim() ? "DATABASE_URL" : process.env.POSTGRES_URL?.trim() ? "POSTGRES_URL" : null, host },
    steps,
  };
}
