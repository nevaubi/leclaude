import { pageDb } from "@/lib/db/request";
import * as React from "react";
import type { Metadata } from "next";
import { Settings as SettingsIcon } from "lucide-react";
import { PageTopbar } from "@/components/shell/page-topbar";
import { KeyValueList } from "@/components/ui/form";
import { aiRuntimeStatus } from "@/lib/ai/config";
import { db } from "@/lib/db";
import { currentUser, DEFAULT_USER } from "@/lib/current-user";
import { workspaceView } from "@/modules/workspace/service";
import { TeamSettings } from "@/modules/workspace/components/team-settings";
import { IntegrityPanel } from "@/modules/settings/integrity-panel";
import { ReviewQueueSummary } from "@/modules/settings/review-queue-summary";
import { SettingsNav } from "@/modules/settings/settings-nav";
import { SettingsSection, SettingsBlock } from "@/modules/settings/settings-section";
import { ProviderTable } from "@/modules/settings/provider-table";
import { DataAutomationSection } from "@/modules/settings/data-automation";
import { AiSettings } from "@/modules/settings/ai-settings";
import { WorkspaceSettings } from "@/modules/settings/workspace-settings";
import { providersPayload } from "@/modules/settings/providers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

/**
 * Settings: one page, left navigation. The workspace (firm profile, team) is
 * edited here; model and provider configuration is read from the environment
 * and reported by presence, never by value.
 */
export default async function SettingsPage() {
  await pageDb();
  const ai = aiRuntimeStatus();
  const d = db();
  const me = currentUser((id) => d.people.get(id)?.name);
  const signedIn = me.id === DEFAULT_USER.id && me.name === DEFAULT_USER.name ? "Not set up" : me.name;
  const workspace = workspaceView();
  const providers = providersPayload();
  const matters = d.matters.all().map((m) => ({ id: m.id, shortName: m.shortName }));
  const counts: { label: string; value: number }[] = [
    { label: "Matters", value: d.matters.count() }, { label: "People", value: d.people.count() }, { label: "E-discovery docs", value: d.edocs.count() },
    { label: "Depositions", value: d.depositions.count() }, { label: "Workflows", value: d.workflows.count() }, { label: "Office documents", value: d.officeDocs.count() },
    { label: "Library items", value: d.library.count() }, { label: "Tasks", value: d.tasks.count() }, { label: "Events", value: d.events.count() },
  ];
  const primary = ai.roles.primary;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={<SettingsIcon />} title="Settings" context={primary ? `${primary.provider} · ${primary.model}` : "No model provider configured"} />
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div className="mx-auto grid max-w-6xl gap-x-10 gap-y-4 px-4 py-6 md:grid-cols-[168px_minmax(0,1fr)] md:px-6">
          <div className="md:sticky md:top-0 md:self-start">
            <SettingsNav />
          </div>
          <div className="min-w-0 space-y-10">
            <SettingsSection id="workspace" title="Workspace" description="The firm and the owner recorded at setup.">
              <WorkspaceSettings initial={workspace} />
            </SettingsSection>

            <SettingsSection id="team" title="Team" bare>
              <TeamSettings />
            </SettingsSection>

            <SettingsSection id="ai" title="AI" description="Model providers are read from the environment; edit .env.local and restart to change them. Outputs carry provenance and are verified before they are trusted.">
              <AiSettings status={ai} />
            </SettingsSection>

            <SettingsSection id="research" title="Research providers" description="Public endpoints work without keys; tokens raise rate limits and unlock crawling and web search.">
              <ProviderTable initial={providers} />
            </SettingsSection>

            <SettingsSection id="data" title="Data & automation" description="Sources that feed the intelligence layer, their schedules, the job log and local folders.">
              <DataAutomationSection background={providers.background} dataDir={providers.dataDir} corpusFolders={providers.providers.find((p) => p.id === "local-corpus")?.facts?.folders as number ?? 0} />
            </SettingsSection>

            <SettingsSection id="integrity" title="Integrity" description={`Records, the AI review queue, scans and the hash-chained audit log. Database in ${providers.dataDir}.`}>
              <div className="space-y-3">
                <SettingsBlock title="Records">
                  <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                    {counts.map((c) => (
                      <div key={c.label} className="flex h-7 items-center justify-between border-b border-line-quiet text-[12px]"><span className="text-muted-foreground">{c.label}</span><span className="tabular">{c.value.toLocaleString()}</span></div>
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
                { label: "Firm", value: workspace.configured ? workspace.firmName : "Not set up", muted: !workspace.configured },
                { label: "Signed in as", value: signedIn },
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
