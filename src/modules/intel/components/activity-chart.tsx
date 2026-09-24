"use client";
import * as React from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { IntelSeries } from "../types";
import { monthLabel, sum, type Anomaly } from "../analysis/pure";
import { chartRows, foldSeries, seriesColor } from "./models";

/**
 * Charts for the intelligence layer, following the platform's chart rules:
 * one axis, 2px lines, recessive grid, a legend for two or more series with
 * direct end labels, hover tooltips, and a table view for every chart so
 * identity never depends on colour alone. Colours come from the chart tokens
 * in a fixed order; text uses text tokens.
 */

interface TipPayload { name?: string | number; value?: number | string; color?: string; dataKey?: string | number }

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TipPayload[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md">
      <div className="mb-0.5 font-medium">{String(label)}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: p.color }} aria-hidden /><span className="min-w-0 flex-1 truncate">{String(p.name ?? p.dataKey)}</span><span className="tabular">{p.value}</span></div>
      ))}
    </div>
  );
}

function EndLabel(props: { x?: number; y?: number; value?: number | string; index?: number; count: number; color: string; text: string }) {
  if (props.index !== props.count - 1 || props.x == null || props.y == null) return null;
  return <text x={props.x + 6} y={props.y} dy={4} fontSize={10.5} className="fill-foreground" style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}>{props.text}</text>;
}

export interface SeriesChartProps {
  months: string[];
  series: IntelSeries[];
  anomalies?: { series: string; anomaly: Anomaly }[];
  height?: number;
  /** "bars" for one series over few months; default lines. */
  kind?: "lines" | "bars";
  className?: string;
  /** Hide the legend/table strip (compact insight previews). */
  minimal?: boolean;
  ariaLabel?: string;
}

export function SeriesChart({ months, series, anomalies = [], height = 220, kind = "lines", className, minimal, ariaLabel }: SeriesChartProps) {
  const [table, setTable] = React.useState(false);
  const folded = React.useMemo(() => foldSeries(series), [series]);
  const rows = React.useMemo(() => chartRows(months, folded), [months, folded]);
  if (!months.length || !folded.length) return <div className={cn("flex items-center justify-center text-[11.5px] text-muted-foreground", className)} style={{ height }}>No dated records in this range.</div>;
  const single = folded.length === 1;
  const axis = { tick: { fontSize: 10.5, fill: "var(--muted-foreground)" }, axisLine: false as const, tickLine: false as const };
  return (
    <div className={cn("min-w-0", className)}>
      <div style={{ height }} role="img" aria-label={ariaLabel ?? `${folded.map((s) => s.label).join(", ")} by month`}>
        {table ? (
          <div className="h-full overflow-auto scrollbar-thin rounded-md border">
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-background"><tr className="grid-head border-b"><th className="px-2 py-1 text-left font-medium">Month</th>{folded.map((s) => <th key={s.label} className="px-2 py-1 text-right font-medium">{s.label}</th>)}</tr></thead>
              <tbody>{rows.map((r) => <tr key={String(r.t)} className="border-b border-line-quiet last:border-b-0"><td className="px-2 py-0.5 whitespace-nowrap">{String(r.label)}</td>{folded.map((s) => <td key={s.label} className="px-2 py-0.5 text-right tabular">{r[s.label]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {kind === "bars" && single ? (
              <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--line-quiet)" />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...axis} allowDecimals={false} width={40} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--accent)", opacity: 0.5 }} />
                <Bar dataKey={folded[0].label} fill={seriesColor(0)} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              </BarChart>
            ) : (
              <LineChart data={rows} margin={{ top: 8, right: 64, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--line-quiet)" />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...axis} allowDecimals={false} width={40} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
                {folded.map((s, i) => (
                  <Line key={s.label} type="monotone" dataKey={s.label} stroke={seriesColor(i)} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} isAnimationActive={false}>
                    {!single && i < 4 && <LabelList dataKey={s.label} content={(p) => <EndLabel {...(p as { x?: number; y?: number; value?: number | string; index?: number })} count={rows.length} color={seriesColor(i)} text={s.label.length > 22 ? `${s.label.slice(0, 20)}…` : s.label} />} />}
                  </Line>
                ))}
                {anomalies.map((a, i) => <ReferenceDot key={i} x={monthLabel(a.anomaly.t)} y={a.anomaly.v} r={5} fill="none" stroke="var(--destructive)" strokeWidth={1.5} ifOverflow="discard" />)}
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      {!minimal && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {folded.map((s, i) => <span key={s.label} className="inline-flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: seriesColor(i) }} aria-hidden /><span className="text-foreground">{s.label}</span><span className="tabular">{sum(s.points)}</span></span>)}
          {anomalies.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2 rounded-full border border-destructive" aria-hidden />{anomalies.length} anomal{anomalies.length === 1 ? "y" : "ies"}</span>}
          <span className="flex-1" />
          <Button variant="ghost" size="xs" className="h-6 px-1.5 text-[11px]" onClick={() => setTable((t) => !t)} aria-pressed={table}><Table2 className="size-3" /> {table ? "Chart" : "Table"}</Button>
        </div>
      )}
    </div>
  );
}

/** One quiet series of monthly counts (profiles, insight previews). */
export function ActivityBars({ series, height = 120, className, minimal }: { series: IntelSeries; height?: number; className?: string; minimal?: boolean }) {
  return <SeriesChart months={series.points.map((p) => p.t)} series={[series]} kind="bars" height={height} className={className} minimal={minimal} />;
}
