import "server-only";
import { z } from "zod";
import { dedupeMentions, mention } from "../mentions";
import { fdaDateRange, fdaSearchClause, type FdaEndpoint, type FdaEnforcementRecord } from "../providers/openfda";
import { defineAdapter } from "./types";

const schema = z.object({
  endpoints: z.array(z.enum(["drug", "device", "food"])).default(["drug"]),
  /** Product search terms (product_description / generic or brand name). */
  products: z.array(z.string().min(2)).default([]),
  /** Recalling firms to watch. */
  firms: z.array(z.string().min(2)).default([]),
  /** Class I, Class II, Class III */
  classifications: z.array(z.string()).default([]),
  sinceDays: z.number().int().min(1).max(3650).default(180),
  maxResults: z.number().int().min(1).max(500).default(50),
  /** Products whose current drug label should be kept (indexed as regulation + tag drug-label). */
  labels: z.array(z.string().min(2)).default([]),
  /** Device brand/generic names whose MAUDE adverse events should be pulled. */
  deviceEvents: z.array(z.string().min(2)).default([]),
  maxDeviceEvents: z.number().int().min(1).max(200).default(25),
});

export type OpenFdaRecallsConfig = z.infer<typeof schema>;

function recallText(r: FdaEnforcementRecord): string {
  return [
    `${r.classification ?? "Recall"} — ${r.product}`,
    r.recallNumber ? `Recall number: ${r.recallNumber}` : "",
    r.eventId ? `Event ID: ${r.eventId}` : "",
    r.status ? `Status: ${r.status}` : "",
    r.recallingFirm ? `Recalling firm: ${r.recallingFirm}${[r.city, r.state, r.country].filter(Boolean).length ? ` (${[r.city, r.state, r.country].filter(Boolean).join(", ")})` : ""}` : "",
    r.initiationDate ? `Recall initiated: ${r.initiationDate}` : "",
    r.reportDate ? `Report date: ${r.reportDate}` : "",
    r.centerClassificationDate ? `Center classification date: ${r.centerClassificationDate}` : "",
    r.terminationDate ? `Terminated: ${r.terminationDate}` : "",
    r.voluntaryMandated ? `Type: ${r.voluntaryMandated}` : "",
    "",
    r.reason ? `Reason for recall\n${r.reason}` : "",
    r.codeInfo ? `\nCode information\n${r.codeInfo}` : "",
    r.quantity ? `\nQuantity: ${r.quantity}` : "",
    r.distribution ? `\nDistribution\n${r.distribution}` : "",
    r.openfda.genericName?.length ? `\nGeneric name: ${r.openfda.genericName.join("; ")}` : "",
    r.openfda.brandName?.length ? `Brand name: ${r.openfda.brandName.join("; ")}` : "",
    r.openfda.manufacturerName?.length ? `Manufacturer: ${r.openfda.manufacturerName.join("; ")}` : "",
    r.openfda.ndc?.length ? `NDC: ${r.openfda.ndc.slice(0, 20).join(", ")}` : "",
    r.openfda.applicationNumber?.length ? `Application: ${r.openfda.applicationNumber.join(", ")}` : "",
  ].filter((l, i, a) => l || (i > 0 && a[i - 1])).join("\n");
}

/** FDA enforcement reports (recalls), drug labels and device adverse events for watched products and firms. */
export const openFdaRecallsAdapter = defineAdapter<OpenFdaRecallsConfig>({
  id: "openfda-recalls",
  name: "FDA recalls and labels (openFDA)",
  description: "Enforcement reports for watched products and firms, current drug labels, and device adverse events.",
  kinds: ["recall", "regulation", "adverse_event"],
  family: "openfda",
  requires: ["openfda"],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    const products = Array.from(new Set([...cfg.products, ...(ctx.scope.targets ?? [])].map((p) => p.trim()).filter(Boolean)));
    if (!products.length && !cfg.firms.length && !cfg.labels.length && !cfg.deviceEvents.length) { ctx.note("No products, firms or labels configured."); return; }
    const from = new Date((ctx.since ? new Date(ctx.since) : new Date(ctx.now.getTime() - cfg.sinceDays * 86400_000)).getTime());
    const range = fdaDateRange("report_date", from, ctx.now);
    const clauses: string[] = [];
    if (products.length) clauses.push(`(${fdaSearchClause(products, "product_description")}+OR+${fdaSearchClause(products, "openfda.generic_name")}+OR+${fdaSearchClause(products, "openfda.brand_name")})`);
    if (cfg.firms.length) clauses.push(fdaSearchClause(cfg.firms, "recalling_firm"));
    const productOrFirm = clauses.length > 1 ? `(${clauses.join("+OR+")})` : clauses[0];
    for (const endpoint of cfg.endpoints as FdaEndpoint[]) {
      if (!productOrFirm || ctx.budgetLeft() <= 0) break;
      const search = [productOrFirm, range, cfg.classifications.length ? fdaSearchClause(cfg.classifications, "classification") : ""].filter(Boolean).join("+AND+");
      const res = await ctx.attempt(`${endpoint} enforcement`, () => ctx.providers.openfda.enforcement({ endpoint, search, limit: cfg.maxResults, signal: ctx.signal }), { provider: "openfda" });
      for (const r of res?.results ?? []) {
        if (ctx.budgetLeft() <= 0) break;
        if (!r.recallNumber) continue;
        const names = [...(r.openfda.genericName ?? []), ...(r.openfda.brandName ?? [])].slice(0, 6);
        await ctx.attempt(`ingest recall ${r.recallNumber}`, () => ctx.ingest({
          kind: "recall",
          title: `${r.classification ?? "Recall"}: ${r.product.slice(0, 160)}`,
          summary: r.reason?.slice(0, 600),
          jurisdiction: "Federal",
          agencies: ["Food and Drug Administration"],
          dates: { event: r.initiationDate ?? r.reportDate, published: r.reportDate, modified: r.terminationDate },
          url: `https://api.fda.gov/${endpoint}/enforcement.json?search=recall_number:"${encodeURIComponent(r.recallNumber)}"`,
          externalId: `fda:recall:${r.recallNumber}`,
          text: recallText(r),
          tags: ["fda", "recall", endpoint, (r.classification ?? "").toLowerCase().replace(/\s+/g, "-")].filter(Boolean),
          entities: dedupeMentions([
            ...names.map((n) => mention("product", n)),
            names.length ? null : mention("product", r.product.split(/[,;(]/)[0].slice(0, 80)),
            r.recallingFirm ? mention("party", r.recallingFirm, { role: "recalling_firm" }) : null,
            ...(r.openfda.manufacturerName ?? []).slice(0, 3).map((m) => mention("party", m, { role: "manufacturer" })),
            mention("agency", "Food and Drug Administration"),
          ]),
          confidence: 0.92,
          meta: { recallNumber: r.recallNumber, eventId: r.eventId, classification: r.classification, status: r.status, recallingFirm: r.recallingFirm, endpoint, productType: r.productType, ndc: r.openfda.ndc?.slice(0, 20), applicationNumber: r.openfda.applicationNumber, voluntaryMandated: r.voluntaryMandated },
        }));
      }
    }
    for (const label of cfg.labels) {
      if (ctx.budgetLeft() <= 0) break;
      const res = await ctx.attempt(`label ${label}`, () => ctx.providers.openfda.drugLabels({ search: `(${fdaSearchClause([label], "openfda.generic_name")}+OR+${fdaSearchClause([label], "openfda.brand_name")})`, limit: 3, signal: ctx.signal }), { provider: "openfda" });
      for (const l of res?.results ?? []) {
        if (!l.setId && !l.id) continue;
        const brand = l.brandName?.[0] ?? label;
        const sections = [["Boxed warning", l.boxedWarning], ["Indications and usage", l.indications], ["Contraindications", l.contraindications], ["Warnings and precautions", l.warningsAndCautions ?? l.warnings], ["Adverse reactions", l.adverseReactions]].filter(([, v]) => v).map(([k, v]) => `${k}\n${v}`).join("\n\n");
        if (!sections) continue;
        await ctx.attempt(`ingest label ${brand}`, () => ctx.ingest({
          kind: "regulation",
          title: `Prescribing information: ${brand}${l.genericName?.[0] && l.genericName[0].toLowerCase() !== brand.toLowerCase() ? ` (${l.genericName[0]})` : ""}`,
          jurisdiction: "Federal",
          agencies: ["Food and Drug Administration"],
          dates: { effective: l.effectiveTime, modified: l.effectiveTime },
          url: l.setId ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${l.setId}` : undefined,
          externalId: `fda:label:${l.setId ?? l.id}`,
          text: sections,
          tags: ["fda", "drug-label"],
          entities: dedupeMentions([mention("product", brand), ...(l.genericName ?? []).slice(0, 2).map((g) => mention("product", g)), ...(l.manufacturerName ?? []).slice(0, 2).map((m) => mention("party", m, { role: "manufacturer" })), mention("agency", "Food and Drug Administration")]),
          confidence: 0.9,
          meta: { setId: l.setId, ndc: l.ndc?.slice(0, 20), applicationNumber: l.applicationNumber, manufacturer: l.manufacturerName, hasBoxedWarning: Boolean(l.boxedWarning) },
        }));
      }
    }
    for (const device of cfg.deviceEvents) {
      if (ctx.budgetLeft() <= 0) break;
      const res = await ctx.attempt(`device events ${device}`, () => ctx.providers.openfda.deviceEvents({ search: `(${fdaSearchClause([device], "device.brand_name")}+OR+${fdaSearchClause([device], "device.generic_name")})+AND+${fdaDateRange("date_received", from, ctx.now)}`, limit: cfg.maxDeviceEvents, signal: ctx.signal }), { provider: "openfda" });
      for (const e of res?.results ?? []) {
        if (ctx.budgetLeft() <= 0) break;
        if (!e.reportNumber) continue;
        await ctx.attempt(`ingest MDR ${e.reportNumber}`, () => ctx.ingest({
          kind: "adverse_event",
          title: `MDR ${e.reportNumber}: ${e.brandName ?? e.genericName ?? device}${e.eventType ? ` (${e.eventType})` : ""}`,
          jurisdiction: "Federal",
          agencies: ["Food and Drug Administration"],
          dates: { event: e.dateOfEvent ?? e.dateReceived, published: e.dateReceived },
          externalId: `fda:mdr:${e.reportNumber}`,
          text: [`${e.brandName ?? ""} ${e.genericName ? `(${e.genericName})` : ""}`.trim(), e.manufacturer ? `Manufacturer: ${e.manufacturer}` : "", e.productProblems.length ? `Product problems: ${e.productProblems.join("; ")}` : "", "", e.narrative].filter(Boolean).join("\n"),
          tags: ["fda", "maude", "adverse-event"],
          entities: dedupeMentions([mention("product", e.brandName ?? e.genericName ?? device), e.manufacturer ? mention("party", e.manufacturer, { role: "manufacturer" }) : null, mention("agency", "Food and Drug Administration")]),
          confidence: 0.8,
          meta: { reportNumber: e.reportNumber, eventType: e.eventType, productProblems: e.productProblems, manufacturer: e.manufacturer },
        }));
      }
    }
  },
});
