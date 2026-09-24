import * as React from "react";
import type { Metadata } from "next";
import { Settings as SettingsIcon } from "lucide-react";
import { TopbarSlot } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { aiConfig } from "@/lib/ai/config";
import { db } from "@/lib/db";
import { IntegrityPanel } from "@/modules/settings/integrity-panel";
import { ReviewQueueSummary } from "@/modules/settings/review-queue-summary";
import { SettingsNav } from "@/modules/settings/settings-nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

function Group({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={`group-${id}`} className="scroll-mt-4 space-y-3">
      <div id={id} className="scroll-mt-4">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const cfg = aiConfig();
  const d = db();
  const rows: [string, string][] = [
    ["Primary model", cfg.model],
    ["Fast model", cfg.fastModel],
    ["Embedding model", cfg.embeddingModel],
    ["Image model", cfg.imageModel],
    ["Reasoning effort", cfg.reasoningEffort],
    ["Base URL", cfg.baseURL ?? "https://api.openai.com/v1"],
  ];
  const matters = d.matters.all().map((m) => ({ id: m.id, shortName: m.shortName }));
  const courtListener = !!process.env.COURTLISTENER_API_TOKEN;
  const govInfo = !!process.env.GOVINFO_API_KEY && process.env.GOVINFO_API_KEY !== "DEMO_KEY";
  const counts: [string, number][] = [["Matters", d.matters.count()], ["People", d.people.count()], ["E-discovery docs", d.edocs.count()], ["Depositions", d.depositions.count()], ["Workflows", d.workflows.count()], ["Office documents", d.officeDocs.count()], ["Library items", d.library.count()], ["Tasks", d.tasks.count()], ["Events", d.events.count()]];

  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <TopbarSlot>
        <SettingsIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Settings</span>
        <span className="hidden text-xs text-muted-foreground md:inline">{cfg.hasKey ? `OpenAI · ${cfg.model}` : "AI features need an OpenAI key"}</span>
      </TopbarSlot>
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <PageHeader title="Settings" description="Configuration is read from environment variables; edit .env.local and restart to change it." />
        <div className="mt-5 grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
          <SettingsNav className="md:sticky md:top-2 md:self-start" />
          <div className="space-y-10">
            <Group id="ai" title="AI" description="Every assistant, agent, research synthesis, e-discovery analysis and workflow AI step calls the OpenAI Responses API with these settings. Outputs carry provenance and are verified against their sources before they are trusted.">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">Model configuration {cfg.hasKey ? <Badge variant="success">key detected</Badge> : <Badge variant="warning">OPENAI_API_KEY missing</Badge>}</CardTitle>
                  <CardDescription>{cfg.hasKey ? "AI features are live." : "AI features degrade gracefully: computed fallbacks are shown and marked as such until a key is added."}</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
                    {rows.map(([k, v]) => (<React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-mono text-xs">{v}</dd></React.Fragment>))}
                  </dl>
                  {!cfg.hasKey && (
                    <pre className="mt-4 rounded-md border bg-muted p-3 text-xs">{`# .env.local\nOPENAI_API_KEY=sk-...\nOPENAI_MODEL=gpt-5.4\nOPENAI_FAST_MODEL=gpt-5.4-mini`}</pre>
                  )}
                </CardContent>
              </Card>
            </Group>

            <Group id="research" title="Research providers" description="Public endpoints work without keys; tokens raise rate limits.">
              <Card>
                <CardContent className="space-y-1.5 pt-4 text-sm">
                  <ProviderRow label="CourtListener (case law, dockets, citation lookup)" ok={courtListener} okLabel="token set" fallback="anonymous" />
                  <ProviderRow label="eCFR (regulations)" ok okLabel="public" />
                  <ProviderRow label="Federal Register" ok okLabel="public" />
                  <ProviderRow label="GovInfo (U.S. Code, Public Laws)" ok={govInfo} okLabel="key set" fallback="DEMO_KEY" />
                  <ProviderRow label="OpenAI web search" ok={cfg.hasKey} okLabel="enabled" fallback="needs key" />
                </CardContent>
              </Card>
            </Group>

            <Group id="integrity" title="Data & integrity" description={`SQLite database in ${process.env.LECLAUDE_DATA_DIR || "./data"}. Scans, the hash-chained audit log and the AI review queue live here.`}>
              <Card>
                <CardHeader><CardTitle>Records</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  {counts.map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b py-1"><span className="text-muted-foreground">{k}</span><span className="tabular">{v.toLocaleString()}</span></div>
                  ))}
                </CardContent>
              </Card>
              <ReviewQueueSummary matters={matters} />
              <IntegrityPanel />
            </Group>

            <Group id="about" title="About">
              <Card>
                <CardContent className="grid gap-x-6 gap-y-1 pt-4 text-sm sm:grid-cols-2">
                  <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">Application</span><span>{process.env.NEXT_PUBLIC_APP_NAME ?? "LeClaude"}</span></div>
                  <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">Firm</span><span>{process.env.NEXT_PUBLIC_FIRM_NAME ?? "Seeger Weiss LLP"}</span></div>
                  <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">Runtime</span><span className="font-mono text-xs">Next.js 15 · React 19 · Node {process.versions.node}</span></div>
                  <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">Environment</span><span className="font-mono text-xs">{process.env.NODE_ENV}</span></div>
                  <div className="flex justify-between border-b py-1"><span className="text-muted-foreground">Keyboard</span><span className="text-xs">⌘K palette · G H/S/E/W/O/L/, navigation · [ toggles the rail</span></div>
                </CardContent>
              </Card>
            </Group>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderRow({ label, ok, okLabel, fallback }: { label: string; ok: boolean; okLabel: string; fallback?: string }) {
  return <div className="flex items-center justify-between gap-3"><span>{label}</span><Badge variant={ok ? "success" : "muted"}>{ok ? okLabel : fallback}</Badge></div>;
}
