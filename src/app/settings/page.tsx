import * as React from "react";
import type { Metadata } from "next";
import { Settings as SettingsIcon } from "lucide-react";
import { PageTopbar } from "@/components/shell/page-topbar";
import { KeyValueList } from "@/components/ui/form";
import { aiConfig } from "@/lib/ai/config";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/current-user";
import { IntegrityPanel } from "@/modules/settings/integrity-panel";
import { ReviewQueueSummary } from "@/modules/settings/review-queue-summary";
import { SettingsNav } from "@/modules/settings/settings-nav";
import { SettingsSection, SettingsBlock } from "@/modules/settings/settings-section";
import { ProviderTable } from "@/modules/settings/provider-table";
import { DataAutomationSection } from "@/modules/settings/data-automation";
import { providersPayload } from "@/modules/settings/providers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

/**
 * Settings: one dense page, left navigation, five sections. Configuration is
 * environment-only; the page reports presence, never secret values.
 */
export default function SettingsPage() {
  const cfg = aiConfig();
  const d = db();
  const me = currentUser((id) => d.people.get(id)?.name);
  const providers = providersPayload();
  const matters = d.matters.all().map((m) => ({ id: m.id, shortName: m.shortName }));
  const counts: { label: string; value: number }[] = [
    { label: "Matters", value: d.matters.count() }, { label: "People", value: d.people.count() }, { label: "E-discovery docs", value: d.edocs.count() },
    { label: "Depositions", value: d.depositions.count() }, { label: "Workflows", value: d.workflows.count() }, { label: "Office documents", value: d.officeDocs.count() },
    { label: "Library items", value: d.library.count() }, { label: "Tasks", value: d.tasks.count() }, { label: "Events", value: d.events.count() },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={SettingsIcon} title="Settings" context={cfg.hasKey ? `OpenAI · ${cfg.model}` : "AI features need an OpenAI key"} />
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto grid max-w-6xl gap-x-6 gap-y-3 p-3 md:grid-cols-[176px_minmax(0,1fr)] md:p-4">
          <div className="md:sticky md:top-0 md:self-start">
            <div className="mb-2 hidden text-[11px] text-muted-foreground md:block">Read from the environment. Edit <code className="font-mono">.env.local</code> and restart to change.</div>
            <SettingsNav />
          </div>
          <div className="min-w-0 space-y-6">
            <SettingsSection id="ai" title="AI" description="Assistants, research synthesis, e-discovery analysis and workflow steps call the OpenAI Responses API; outputs carry provenance and are verified before they are trusted.">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                <SettingsBlock title="Model configuration" description={cfg.hasKey ? "AI features are live." : "AI features degrade gracefully: computed fallbacks are shown and marked as such until a key is added."}>
                  <KeyValueList dense labelWidth={150} items={[
                    { label: "API key", value: cfg.hasKey ? <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-success" aria-hidden />OPENAI_API_KEY set</span> : <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-warning" aria-hidden />OPENAI_API_KEY missing</span> },
                    { label: "Primary model", value: cfg.model, mono: true },
                    { label: "Fast model", value: cfg.fastModel, mono: true },
                    { label: "Embedding model", value: cfg.embeddingModel, mono: true },
                    { label: "Image model", value: cfg.imageModel, mono: true },
                    { label: "Reasoning effort", value: cfg.reasoningEffort, mono: true },
                    { label: "Base URL", value: cfg.baseURL ?? "https://api.openai.com/v1", mono: true },
                  ]} />
                </SettingsBlock>
                <SettingsBlock title={cfg.hasKey ? "Where AI appears" : "Add a key"}>
                  {cfg.hasKey ? (
                    <ul className="space-y-1 text-[12px] text-muted-foreground">
                      <li>Home assistant and daily brief</li><li>Research synthesis and verification</li><li>E-discovery coding suggestions and digests</li><li>Office Draft / Review / Ask</li><li>Workflow AI steps and the job steward</li>
                    </ul>
                  ) : (
                    <pre className="rounded-md border bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">{`# .env.local\nOPENAI_API_KEY=sk-...\nOPENAI_MODEL=${cfg.model}\nOPENAI_FAST_MODEL=${cfg.fastModel}`}</pre>
                  )}
                </SettingsBlock>
              </div>
            </SettingsSection>

            <SettingsSection id="research" title="Research providers" description="Public endpoints work without keys; tokens raise rate limits and unlock crawling and web search.">
              <ProviderTable initial={providers} />
            </SettingsSection>

            <SettingsSection id="data" title="Data & automation" description="Background ingestion, scheduled sources, jobs and the local document corpus.">
              <DataAutomationSection background={providers.background} dataDir={providers.dataDir} corpusFolders={providers.providers.find((p) => p.id === "local-corpus")?.facts?.folders as number ?? 0} />
            </SettingsSection>

            <SettingsSection id="integrity" title="Integrity" description={`SQLite database in ${providers.dataDir}. Records, the AI review queue, scans and the hash-chained audit log.`}>
              <div className="space-y-3">
                <SettingsBlock title="Records">
                  <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                    {counts.map((c) => (
                      <div key={c.label} className="flex h-6 items-center justify-between border-b border-line-quiet text-[12px]"><span className="text-muted-foreground">{c.label}</span><span className="tabular">{c.value.toLocaleString()}</span></div>
                    ))}
                  </div>
                </SettingsBlock>
                <ReviewQueueSummary matters={matters} />
                <IntegrityPanel />
              </div>
            </SettingsSection>

            <SettingsSection id="about" title="About">
              <KeyValueList dense columns={2} labelWidth={120} items={[
                { label: "Application", value: process.env.NEXT_PUBLIC_APP_NAME ?? "LeClaude" },
                { label: "Firm", value: process.env.NEXT_PUBLIC_FIRM_NAME ?? "Seeger Weiss LLP" },
                { label: "Signed in as", value: `${me.name} (${me.id})` },
                { label: "Runtime", value: `Next.js 15 · React 19 · Node ${process.versions.node}`, mono: true },
                { label: "Environment", value: process.env.NODE_ENV, mono: true },
                { label: "Keyboard", value: "⌘K palette · ? shortcuts · G H/S/I/E/W/O/L/, navigation · [ rail" },
              ]} />
            </SettingsSection>
          </div>
        </div>
      </div>
    </div>
  );
}
