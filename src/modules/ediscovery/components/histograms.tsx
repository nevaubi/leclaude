"use client";
import * as React from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import type { DateBucket, FacetBucket } from "../types";
import { custodianBars, dateBars, dateGranularity, type HistogramBar } from "./review-helpers";

interface TipPayload { payload?: HistogramBar }

function BarTip({ active, payload }: { active?: boolean; payload?: TipPayload[] }) {
  const b = payload?.[0]?.payload;
  if (!active || !b) return null;
  return (
    <div className="rounded-md border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md">
      <span className="font-medium">{b.label}</span> · <span className="tabular">{b.count.toLocaleString()}</span> document{b.count === 1 ? "" : "s"}{b.selected ? " · filtered" : ""}
    </div>
  );
}

const FILL = "color-mix(in oklch, var(--muted-foreground) 45%, transparent)";
const FILL_SELECTED = "var(--primary)";
const FILL_MUTED = "var(--line-quiet)";

/**
 * Documents per custodian (horizontal bars, top custodians, click to filter) —
 * reads the same facet the checkbox list uses so the two never disagree.
 */
export function CustodianHistogram({ buckets, selected, onToggle, className }: { buckets: FacetBucket[]; selected: string[]; onToggle: (custodianId: string) => void; className?: string }) {
  const bars = React.useMemo(() => custodianBars(buckets, selected), [buckets, selected]);
  if (!bars.length) return null;
  const height = Math.max(64, bars.length * 16 + 8);
  return (
    <div className={cn("min-w-0", className)} style={{ height }} role="img" aria-label="Documents per custodian">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} layout="vertical" margin={{ top: 2, right: 28, bottom: 2, left: 0 }} barCategoryGap={3}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={92} tick={{ fontSize: 10.5, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} interval={0} />
          <Tooltip content={<BarTip />} cursor={{ fill: "var(--accent)", opacity: 0.4 }} />
          <Bar dataKey="count" radius={[0, 2, 2, 0]} isAnimationActive={false} onClick={(d) => { const b = (d as unknown as { payload?: HistogramBar & { others?: boolean } }).payload; if (b && !b.others) onToggle(b.key); }} className="cursor-pointer" label={{ position: "right", fontSize: 10, fill: "var(--muted-foreground)" }}>
            {bars.map((b) => <Cell key={b.key} fill={b.others ? FILL_MUTED : b.selected ? FILL_SELECTED : FILL} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Documents over time: months when the result set spans three years or less,
 * otherwise years; click a bar to filter (months set `months`, years set `years`).
 */
export function DateHistogram({ months, years, selectedMonths, selectedYears, onToggleMonth, onToggleYear, className }: { months: DateBucket[]; years: DateBucket[]; selectedMonths: string[]; selectedYears: string[]; onToggleMonth: (m: string) => void; onToggleYear: (y: string) => void; className?: string }) {
  const granularity = React.useMemo(() => dateGranularity(months), [months]);
  const bars = React.useMemo(() => dateBars(months, years, selectedMonths, selectedYears, granularity), [months, years, selectedMonths, selectedYears, granularity]);
  if (!bars.length) return null;
  const tickEvery = Math.max(1, Math.ceil(bars.length / 6));
  return (
    <div className={cn("min-w-0", className)}>
      <div style={{ height: 72 }} role="img" aria-label={`Documents per ${granularity}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 4, right: 2, bottom: 0, left: 2 }} barCategoryGap={bars.length > 24 ? 1 : 2}>
            <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} interval={tickEvery - 1} height={14} />
            <YAxis hide allowDecimals={false} />
            <Tooltip content={<BarTip />} cursor={{ fill: "var(--accent)", opacity: 0.4 }} />
            <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false} minPointSize={1} onClick={(d) => { const b = (d as unknown as { payload?: HistogramBar }).payload; if (!b || !b.count) return; if (granularity === "month") onToggleMonth(b.key); else onToggleYear(b.key); }} className="cursor-pointer">
              {bars.map((b) => <Cell key={b.key} fill={b.selected ? FILL_SELECTED : b.count ? FILL : FILL_MUTED} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground"><span>{granularity === "month" ? "by month" : "by year"}</span><span className="tabular">{bars[0].label} – {bars[bars.length - 1].label}</span></div>
    </div>
  );
}
