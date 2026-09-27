import * as React from "react";
import { cn } from "@/lib/utils";
import type { AIRuntimeStatus } from "@/lib/ai/config";
import { SettingsBlock } from "./settings-section";

const PROVIDER_LABEL: Record<string, string> = { bedrock: "Amazon Bedrock", anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter (router only)" };
const ROLE_LABEL: Record<string, string> = { primary: "Primary", fast: "Fast", router: "Router", embedding: "Embeddings", image: "Images", vision: "Vision" };

/**
 * Settings → AI: which model provider serves each role (from the coded capability registry and the
 * environment), which providers are configured, and what is missing. Presence only; no secret values.
 */
export function AiSettings({ status }: { status: AIRuntimeStatus }) {
  return (
    <div className="space-y-3">
      <SettingsBlock title="Model roles" description={status.configured ? "Every AI feature routes through these roles." : "No provider serves the primary role yet; AI features show computed fallbacks until one is configured."}>
        <div role="table" aria-label="Model roles" className="text-[12.5px]">
          {(Object.keys(ROLE_LABEL) as (keyof AIRuntimeStatus["roles"])[]).map((role) => {
            const r = status.roles[role];
            return (
              <div key={role} role="row" className="grid min-h-7 grid-cols-[110px_minmax(0,1fr)] items-center gap-3 border-b border-line-quiet last:border-b-0 sm:grid-cols-[110px_160px_minmax(0,1fr)]">
                <span className="text-muted-foreground">{ROLE_LABEL[role]}</span>
                <span className={cn("truncate", !r && "text-muted-foreground")}>{r ? PROVIDER_LABEL[r.provider] ?? r.provider : "Not configured"}</span>
                <span className="hidden truncate font-mono text-[11.5px] text-muted-foreground sm:inline">{r?.model ?? "—"}</span>
              </div>
            );
          })}
        </div>
      </SettingsBlock>
      <SettingsBlock title="Providers" description={`Matter data may leave approved infrastructure: ${status.allowExternalForMatterData ? "allowed" : "no"}.${status.preferred ? ` Preferred: ${PROVIDER_LABEL[status.preferred] ?? status.preferred}.` : ""}`}>
        <div role="table" aria-label="Model providers" className="text-[12.5px]">
          {status.providers.map((p) => (
            <div key={p.id} role="row" className="grid min-h-7 grid-cols-[160px_minmax(0,1fr)] items-center gap-3 border-b border-line-quiet py-0.5 last:border-b-0 lg:grid-cols-[160px_140px_minmax(0,1fr)]">
              <span className="font-medium">{PROVIDER_LABEL[p.id] ?? p.id}</span>
              <span className="flex items-center gap-1.5 whitespace-nowrap"><span className={cn("size-1.5 rounded-full", p.configured ? "bg-success" : "bg-muted-foreground/30")} aria-hidden />{p.configured ? "Configured" : "Not configured"}</span>
              <span className="hidden min-w-0 truncate font-mono text-[11.5px] text-muted-foreground lg:inline" title={p.configured ? p.present.join(", ") : p.missing.join(", ")}>{p.configured ? p.present.join(", ") : p.missing.length ? `needs ${p.missing.join(", ")}` : "—"}</span>
            </div>
          ))}
        </div>
        {status.missing.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted-foreground">{status.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        )}
      </SettingsBlock>
    </div>
  );
}
