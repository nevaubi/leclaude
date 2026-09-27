"use client";
import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import type { ProviderStatus, ProvidersPayload } from "./providers";

const STATE_LABEL: Record<ProviderStatus["state"], { label: string; dot: string }> = {
  configured: { label: "Configured", dot: "bg-success" },
  public: { label: "Public", dot: "bg-muted-foreground/60" },
  missing: { label: "Not configured", dot: "bg-muted-foreground/30" },
};

/** Provider rows from GET /api/settings/providers: name, role, env variable, status. Env presence only. */
export function ProviderTable({ initial }: { initial?: ProvidersPayload }) {
  const [data, setData] = React.useState<ProvidersPayload | null>(initial ?? null);
  const [loading, setLoading] = React.useState(!initial);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/providers", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData((await res.json()) as ProvidersPayload);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);
  React.useEffect(() => { if (!initial) void load(); }, [initial, load]);
  // Model providers are listed under AI; this table covers research and data providers.
  const rows = (data?.providers ?? []).filter((p) => p.id !== "openai");
  return (
    <div className="rounded-md border">
      <div className="flex h-8 items-center gap-2 border-b px-3 text-[11.5px] text-muted-foreground">
        <span className="tabular">{data ? `${rows.filter((r) => r.state === "configured").length} configured · ${rows.filter((r) => r.state === "public").length} public · ${rows.filter((r) => r.state === "missing").length} not configured` : error ? `Could not load: ${error}` : "Loading…"}</span>
        <div className="flex-1" />
        <Tip label="Re-read the environment"><Button variant="ghost" size="icon-xs" onClick={() => void load()} disabled={loading} aria-label="Refresh provider status">{loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</Button></Tip>
      </div>
      <div role="table" aria-label="Providers" className="text-[12.5px]">
        <div role="row" className="grid h-7 grid-cols-[130px_minmax(0,1fr)_240px] items-center gap-3 border-b px-3 grid-head lg:grid-cols-[140px_minmax(0,1fr)_170px_280px]">
          <span>Provider</span><span>Used for</span><span className="hidden lg:inline">Variable</span><span>Status</span>
        </div>

        {rows.map((p) => {
          const st = STATE_LABEL[p.state];
          return (
            <div key={p.id} role="row" className="grid min-h-7 grid-cols-[130px_minmax(0,1fr)_240px] items-center gap-3 border-b border-line-quiet px-3 py-0.5 last:border-b-0 lg:grid-cols-[140px_minmax(0,1fr)_170px_280px]">
              <span className="truncate font-medium" title={p.env.join(", ")}>{p.name}</span>
              <span className="truncate text-muted-foreground" title={p.role}>{p.role}</span>
              <span className="hidden truncate font-mono text-[11px] text-muted-foreground lg:inline">{p.env.join(", ") || "—"}</span>
              <span className="flex min-w-0 items-center gap-1.5" title={p.detail}><span className={cn("size-1.5 shrink-0 rounded-full", st.dot)} aria-hidden /><span className="shrink-0 whitespace-nowrap">{st.label}</span><span className="min-w-0 truncate text-[11.5px] text-muted-foreground">· {p.detail}</span></span>
            </div>
          );
        })}
        {!rows.length && !loading && <div className="px-3 py-3 text-[11.5px] text-muted-foreground">No provider information.</div>}
      </div>
    </div>
  );
}
