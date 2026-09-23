import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { aiConfig } from "@/lib/ai/config";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

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
  return (
    <div className="h-full overflow-auto p-6 space-y-6 max-w-4xl">
      <PageHeader title="Settings" description="Platform configuration is read from environment variables; edit .env.local and restart to change it." />
      <Card id="ai">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">AI configuration {cfg.hasKey ? <Badge variant="success">OpenAI key detected</Badge> : <Badge variant="destructive">OPENAI_API_KEY missing</Badge>}</CardTitle>
          <CardDescription>All assistants, agents, search synthesis, e-discovery analysis and workflow AI steps call the OpenAI Responses API with these settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
            {rows.map(([k, v]) => (<><dt key={k + "k"} className="text-muted-foreground">{k}</dt><dd key={k + "v"} className="font-mono text-xs">{v}</dd></>))}
          </dl>
          {!cfg.hasKey && (
            <pre className="mt-4 rounded-md border bg-muted p-3 text-xs">{`# .env.local\nOPENAI_API_KEY=sk-...\nOPENAI_MODEL=gpt-5.4\nOPENAI_FAST_MODEL=gpt-5.4-mini`}</pre>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Research providers</CardTitle><CardDescription>Public endpoints work without keys; tokens raise rate limits.</CardDescription></CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <div className="flex justify-between"><span>CourtListener (case law, dockets, citation lookup)</span><Badge variant={process.env.COURTLISTENER_API_TOKEN ? "success" : "muted"}>{process.env.COURTLISTENER_API_TOKEN ? "token set" : "anonymous"}</Badge></div>
          <div className="flex justify-between"><span>eCFR (regulations)</span><Badge variant="success">public</Badge></div>
          <div className="flex justify-between"><span>Federal Register</span><Badge variant="success">public</Badge></div>
          <div className="flex justify-between"><span>GovInfo (U.S. Code, Public Laws)</span><Badge variant={process.env.GOVINFO_API_KEY && process.env.GOVINFO_API_KEY !== "DEMO_KEY" ? "success" : "muted"}>{process.env.GOVINFO_API_KEY && process.env.GOVINFO_API_KEY !== "DEMO_KEY" ? "key set" : "DEMO_KEY"}</Badge></div>
          <div className="flex justify-between"><span>OpenAI web search</span><Badge variant={cfg.hasKey ? "success" : "muted"}>{cfg.hasKey ? "enabled" : "needs key"}</Badge></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Data</CardTitle><CardDescription>SQLite database in {process.env.LECLAUDE_DATA_DIR || "./data"}.</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {[["Matters", d.matters.count()], ["People", d.people.count()], ["E-discovery docs", d.edocs.count()], ["Depositions", d.depositions.count()], ["Workflows", d.workflows.count()], ["Office documents", d.officeDocs.count()], ["Library items", d.library.count()], ["Tasks", d.tasks.count()], ["Events", d.events.count()]].map(([k, v]) => (
            <div key={String(k)} className="flex justify-between border-b py-1"><span className="text-muted-foreground">{k}</span><span className="tabular">{v}</span></div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
