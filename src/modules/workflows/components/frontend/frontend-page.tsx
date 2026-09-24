"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, KeyRound, Loader2, Play, RotateCcw, Settings2, Workflow as WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TopbarSlot } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, SegmentedControl } from "@/components/ui/form";
import { FolderSelect } from "@/components/ui/entity-selects";
import { RelativeTime } from "@/components/ui/relative-time";
import { EmptyState } from "@/components/ui/misc";
import { frontendFor, mapFrontendValues, OUTPUT_FORMAT_LABEL, validateFrontendValues, type OutputFormat } from "../../frontend";
import { apiJson, ApiError, useWorkflowMeta } from "../../hooks";
import type { RunSummary } from "../../service";
import { InlineAlert, NodeTypeIcon, RunStatusBadge } from "../shared";
import { RunPanel } from "../run/run-panel";
import { FrontendFieldControl } from "./frontend-fields";
import { describeAfter, hasOutputStep, initialFieldValues, initialOutputChoice, outputFormats, sections, stepPreviews, withOutputValues, type OutputChoice, type StartableWorkflow } from "./frontend-helpers";

export interface WorkflowFrontendPageProps {
  workflow: StartableWorkflow;
  recentRuns: RunSummary[];
  initialRunId?: string | null;
}

/**
 * The one-page start form for a workflow: fields from `workflow.frontend` on
 * the left (files upload to /api/workflows/uploads and are text-extracted),
 * what happens and recent runs on the right. Submitting maps the values onto
 * run inputs, starts the run and follows it over SSE in place; outputs, tasks
 * and handoffs appear in the run panel with "Run again".
 */
export function WorkflowFrontendPage({ workflow, recentRuns: recentInitial, initialRunId }: WorkflowFrontendPageProps) {
  const router = useRouter();
  const meta = useWorkflowMeta();
  const frontend = React.useMemo(() => frontendFor(workflow), [workflow]);
  const showOutput = Boolean(frontend.output) || hasOutputStep(workflow.nodes);
  const formats = React.useMemo(() => outputFormats(frontend), [frontend]);
  const steps = React.useMemo(() => stepPreviews(workflow.nodes, workflow.edges), [workflow.nodes, workflow.edges]);
  const [values, setValues] = React.useState<Record<string, unknown>>(() => initialFieldValues(frontend));
  const [output, setOutput] = React.useState<OutputChoice>(() => initialOutputChoice(frontend));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [uploading, setUploading] = React.useState(0);
  const [starting, setStarting] = React.useState(false);
  const [runId, setRunId] = React.useState<string | null>(initialRunId ?? null);
  const [recentRuns, setRecentRuns] = React.useState(recentInitial);
  const usesAI = steps.some((s) => s.usesAI);
  const matterField = frontend.fields.find((f) => f.type === "matter");
  const matterId = matterField && typeof values[matterField.key] === "string" ? (values[matterField.key] as string) : null;
  const workflowNames = React.useMemo(() => Object.fromEntries((meta?.workflows ?? []).map((w) => [w.id, w.name])), [meta]);
  const afterLines = describeAfter(frontend, workflowNames);
  const firstErrorRef = React.useRef<HTMLDivElement>(null);
  const firstErrorKey = frontend.fields.find((f) => errors[f.key])?.key;

  const set = React.useCallback((key: string, v: unknown) => {
    setValues((s) => ({ ...s, [key]: v }));
    setErrors((e) => { if (!e[key]) return e; const n = { ...e }; delete n[key]; return n; });
  }, []);

  const submit = async () => {
    const all = withOutputValues(frontend, values, showOutput ? output : null);
    const errs = validateFrontendValues(frontend, all);
    const map: Record<string, string> = {};
    for (const e of errs) if (!map[e.key]) map[e.key] = e.message;
    setErrors(map);
    if (errs.length) { toast.error(`Check ${errs.length} field${errs.length > 1 ? "s" : ""}`); requestAnimationFrame(() => firstErrorRef.current?.scrollIntoView({ block: "center" })); return; }
    setStarting(true);
    try {
      const mapped = mapFrontendValues(frontend, all);
      const res = await apiJson<{ run: { id: string }; workflow: { id: string; name: string } }>(`/api/workflows/${workflow.id}/run`, { method: "POST", body: JSON.stringify({ inputs: mapped.inputs, matterId: mapped.matterId, frontend: true }) });
      setRunId(res.run.id);
      window.history.replaceState(null, "", `/workflows/${workflow.id}/start?run=${res.run.id}`);
      toast.success("Run started");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not start the run");
    } finally { setStarting(false); }
  };

  const runAgain = () => {
    setRunId(null);
    window.history.replaceState(null, "", `/workflows/${workflow.id}/start`);
    void apiJson<{ runs: RunSummary[] }>(`/api/workflows/runs?workflowId=${encodeURIComponent(workflow.id)}&limit=8`).then((r) => setRecentRuns(r.runs)).catch(() => {});
  };

  const onKeyDown = (e: React.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !runId) { e.preventDefault(); void submit(); } };
  const busy = starting || uploading > 0;
  const customizeHref = `/workflows/${workflow.id}`;

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <TopbarSlot>
        <nav className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link href="/workflows" className="flex items-center gap-1 text-muted-foreground hover:text-foreground"><WorkflowIcon className="size-4" /> Workflows</Link>
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <span className="truncate font-medium">{frontend.title || workflow.name}</span>
          {workflow.isTemplate && <span className="hidden text-[11px] text-muted-foreground sm:inline">template</span>}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" asChild><Link href={customizeHref}><Settings2 className="size-3.5" /> Customize</Link></Button>
          {runId ? (
            <Button size="sm" onClick={runAgain}><RotateCcw className="size-3.5" /> Run again</Button>
          ) : (
            <Button size="sm" onClick={submit} disabled={busy}>{starting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} {frontend.submitLabel ?? "Run"}</Button>
          )}
        </div>
      </TopbarSlot>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Left: form or the run in progress */}
        <div className="min-h-0 overflow-y-auto scrollbar-thin">
          {runId ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex h-9 items-center gap-2 border-b px-4 text-[12.5px]">
                <span className="font-medium">Run</span>
                <span className="font-mono text-[11px] text-muted-foreground">{runId}</span>
                <span className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="xs" asChild><Link href={`/workflows/runs/${runId}`}>Open run page</Link></Button>
                  <Button variant="outline" size="xs" onClick={runAgain}><RotateCcw className="size-3" /> Run again</Button>
                </span>
              </div>
              <RunPanel runId={runId} detailLink={false} wide className="min-h-0 flex-1" onRerun={(id) => { setRunId(id); window.history.replaceState(null, "", `/workflows/${workflow.id}/start?run=${id}`); }} />
            </div>
          ) : (
            <form className="mx-auto max-w-[760px] space-y-6 px-4 py-4 md:px-6" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
              {(frontend.intro || workflow.description) && <p className="text-[13px] leading-relaxed text-muted-foreground">{frontend.intro ?? workflow.description}</p>}
              {usesAI && meta && !meta.aiConfigured && (
                <InlineAlert tone="warning" icon={KeyRound} title="OpenAI key required" action={<Button variant="outline" size="xs" asChild><Link href="/settings#ai">Settings</Link></Button>}>AI steps will fail until OPENAI_API_KEY is set. Data, query and file steps still run.</InlineAlert>
              )}
              {frontend.fields.length === 0 && <EmptyState title="No inputs needed" description="This workflow runs with its configured settings. Start it from the toolbar." />}
              {sections(frontend).map((sec, i) => (
                <FieldGroup key={`${sec.group ?? "main"}-${i}`} title={sec.group}>
                  {sec.fields.map((f) => (
                    <div key={f.key} ref={f.key === firstErrorKey ? firstErrorRef : undefined}>
                      <FrontendFieldControl field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} error={errors[f.key]} meta={meta} workflowId={workflow.id} matterId={matterId} disabled={busy} onBusy={(b) => setUploading((n) => Math.max(0, n + (b ? 1 : -1)))} formats={formats} />
                    </div>
                  ))}
                </FieldGroup>
              ))}
              {showOutput && (
                <FieldGroup title="Output" description="How the deliverable is rendered and where it is filed.">
                  {!frontend.fields.some((f) => f.type === "output-format") && (
                    <Field label="Format">
                      <SegmentedControl size="xs" options={formats.map((f) => ({ value: f, label: OUTPUT_FORMAT_LABEL[f] }))} value={(output.format || formats[0]) as OutputFormat} onChange={(v) => setOutput((o) => ({ ...o, format: v }))} ariaLabel="Output format" />
                    </Field>
                  )}
                  {!frontend.fields.some((f) => f.type === "label") && (
                    <Field label="Label" help="Name of the file and library item. {{ }} placeholders such as {{matter.shortName}} and {{now | date:short}} are filled in at run time." htmlFor="fe_output_label">
                      <Input id="fe_output_label" size="xs" value={output.label} onChange={(e) => setOutput((o) => ({ ...o, label: e.target.value }))} placeholder={`${workflow.name} — {{now | date:short}}`} className="max-w-md" />
                    </Field>
                  )}
                  {!frontend.fields.some((f) => f.type === "library-folder") && (
                    <Field label="Library folder" help="Leave on the default to file under the matter folder." htmlFor="fe_output_folder">
                      <FolderSelect id="fe_output_folder" size="xs" value={output.folderId || null} onChange={(v) => setOutput((o) => ({ ...o, folderId: v ?? "" }))} allowNone noneLabel="Matter folder (default)" className="max-w-sm" />
                    </Field>
                  )}
                </FieldGroup>
              )}
              {afterLines.length > 0 && (
                <div className="text-[11.5px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">After the run: </span>{afterLines.join(" ")}
                </div>
              )}
              <div className="flex items-center gap-2 border-t pt-4">
                <Button type="submit" size="sm" disabled={busy}>{starting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} {frontend.submitLabel ?? "Run"}</Button>
                <span className="text-[11px] text-muted-foreground">{uploading > 0 ? "Uploading…" : "⌘↵ to run"}</span>
              </div>
            </form>
          )}
        </div>

        {/* Right: what happens, recent runs */}
        <aside className="hidden min-h-0 flex-col border-l bg-card lg:flex">
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            <section className="px-3 py-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>What happens</span><span className="normal-case tracking-normal tabular">{steps.length} steps</span></div>
              <ol className="divide-y divide-line-quiet">
                {steps.map((s, i) => (
                  <li key={s.id} className="flex min-h-7 items-center gap-2 py-1 text-[12px]" style={{ paddingLeft: s.depth * 12 }}>
                    <span className="w-4 shrink-0 tabular text-right text-[11px] text-muted-foreground">{i + 1}</span>
                    <NodeTypeIcon type={s.type} size="xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.label}</span>
                      {s.summary && <span className="block truncate text-[11px] text-muted-foreground">{s.summary}</span>}
                    </span>
                    {s.approval && <span className="shrink-0 text-[10.5px] text-muted-foreground">review</span>}
                  </li>
                ))}
              </ol>
            </section>
            <section className="border-t px-3 py-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><span>Recent runs</span><Link href={`/workflows?tab=runs`} className="normal-case tracking-normal text-primary hover:underline">All</Link></div>
              {recentRuns.length === 0 ? <div className="text-[12px] text-muted-foreground">No runs yet.</div> : (
                <ul className="divide-y divide-line-quiet">
                  {recentRuns.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => { setRunId(r.id); window.history.replaceState(null, "", `/workflows/${workflow.id}/start?run=${r.id}`); }} className={cn("flex h-8 w-full items-center gap-2 text-left text-[12px] hover:bg-accent/50 cursor-pointer", r.id === runId && "bg-accent/60")}>
                        <RunStatusBadge status={r.status} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.matterName ?? r.triggeredByName ?? r.triggeredBy}</span>
                        <span className="shrink-0 tabular text-[11px] text-muted-foreground"><RelativeTime value={r.startedAt} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {workflow.isTemplate && (
              <section className="border-t px-3 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
                Runs from a template attach to your own copy of it, created on first use. <button type="button" onClick={() => router.push(customizeHref)} className="text-primary underline-offset-2 hover:underline cursor-pointer">Customize</button> to change steps or fields.
              </section>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
