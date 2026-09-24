"use client";
import * as React from "react";
import Link from "next/link";
import { Radar } from "lucide-react";
import { TrustBadge } from "@/components/ai/trust-badge";
import type { Provenance } from "@/lib/integrity/types";
import { useHomeUI } from "../store";
import { useHome } from "./home-provider";
import { Section } from "./shared";

/**
 * Minimal shape the Home slot needs from an intelligence insight. The intel
 * round owns the real records (`IntelInsight`); this reads only what it renders.
 */
export interface ForYouInsight {
  id: string;
  kind?: string;
  title: string;
  summary?: string;
  confidence?: number;
  provenance?: Provenance;
  scope?: { matterId?: string };
  href?: string;
  updatedAt?: string;
}

/** Accept `{ insights }`, `{ items }` or a bare array; anything else is "no insights". */
export function parseInsights(payload: unknown): ForYouInsight[] {
  const list = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? ((payload as { insights?: unknown; items?: unknown }).insights ?? (payload as { items?: unknown }).items) : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is ForYouInsight => Boolean(x) && typeof x === "object" && typeof (x as ForYouInsight).id === "string" && typeof (x as ForYouInsight).title === "string");
}

const KIND_LABEL: Record<string, string> = { trend: "Trend", cluster: "Cluster", pattern: "Pattern", chronology: "Chronology", profile: "Profile", anomaly: "Anomaly", alert: "Alert", digest: "Digest" };

/**
 * "For you": personalised, source-backed insights from the intelligence layer.
 * Renders nothing until GET /api/intel/insights exists and returns rows, so the
 * overview stays quiet before the intel round lands.
 */
export function ForYouSection() {
  const { userId, matterFilter, matterById } = useHome();
  const setFocus = useHomeUI((s) => s.setFocus);
  const [items, setItems] = React.useState<ForYouInsight[] | null>(null);
  React.useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ userId, limit: "6", status: "published" });
    if (matterFilter) qs.set("matterId", matterFilter);
    fetch(`/api/intel/insights?${qs}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setItems(j ? parseInsights(j) : []); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [userId, matterFilter]);
  if (!items || items.length === 0) return null;
  void setFocus;
  return (
    <Section id="for-you" title="For you" icon={Radar} count={items.length} description="Insights from the intelligence layer, ranked for your matters and watches" actions={<Link href="/intel" className="text-[11px] text-muted-foreground hover:text-primary">Intelligence</Link>}>
      <ul className="divide-y divide-line-quiet">
        {items.map((it) => {
          const matter = matterById(it.scope?.matterId);
          const body = (
            <>
              <span className="w-[76px] shrink-0 text-[10.5px] uppercase tracking-wider text-muted-foreground">{KIND_LABEL[it.kind ?? ""] ?? it.kind ?? "Insight"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{it.title}</span>
                {it.summary && <span className="block truncate text-[11.5px] text-muted-foreground">{it.summary}</span>}
              </span>
              {matter && <span className="hidden shrink-0 text-[11px] text-muted-foreground lg:inline">{matter.shortName}</span>}
              <TrustBadge provenance={it.provenance} compact />
            </>
          );
          const cls = "flex min-h-[34px] w-full items-center gap-3 px-3 py-1 text-left hover:bg-accent/50";
          return <li key={it.id}>{it.href ? <Link href={it.href} className={cls}>{body}</Link> : <Link href={`/intel?insight=${encodeURIComponent(it.id)}`} className={cls}>{body}</Link>}</li>;
        })}
      </ul>
    </Section>
  );
}
