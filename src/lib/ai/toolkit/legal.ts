import "server-only";
import { defineTool } from "../tools";
import { fetchJSON, fetchText, htmlToText, stripXml } from "./http";

const CL = "https://www.courtlistener.com/api/rest/v4";

function clHeaders(): Record<string, string> {
  const token = process.env.COURTLISTENER_API_TOKEN?.trim();
  return token ? { Authorization: `Token ${token}` } : {};
}

interface CLSearchResult {
  count?: number;
  results?: Array<{
    caseName?: string; caseNameFull?: string; citation?: string[]; court?: string; court_id?: string; dateFiled?: string; docketNumber?: string; snippet?: string; absolute_url?: string; cluster_id?: number; judge?: string; status?: string; citeCount?: number;
    opinions?: Array<{ id: number; snippet?: string; type?: string; download_url?: string }>;
    docket_id?: number; assignedTo?: string; suitNature?: string; cause?: string; dateTerminated?: string | null; party?: string[]; attorney?: string[];
  }>;
}

/** Common U.S. court identifiers for CourtListener `court` filters. */
export const COURT_GROUPS: Record<string, string> = {
  "scotus": "scotus",
  "federal-appellate": "ca1 ca2 ca3 ca4 ca5 ca6 ca7 ca8 ca9 ca10 ca11 cadc cafc",
  "federal-district": "",
  "4th-circuit": "ca4 dsc dnc dmd dvae dvaw dwvn dwvs",
  "7th-circuit": "ca7 ilnd ilcd ilsd innd insd wied wiwd",
  "9th-circuit": "ca9 cacd caed cand casd",
  "11th-circuit": "ca11 flnd flmd flsd gand gamd gasd alnd almd alsd",
  "california-state": "cal calctapp",
  "new-york-state": "ny nyappdiv nysupct",
  "delaware": "del delch delsuperct",
  "texas-state": "tex texapp",
  "illinois-state": "ill illappct",
};

export const searchCaseLawTool = defineTool<{ query: string; jurisdiction?: string; courts?: string; filed_after?: string; filed_before?: string; order_by?: string; limit?: number }>({
  name: "search_case_law",
  description: "Search published and unpublished U.S. court opinions (CourtListener, ~10M opinions across federal and state courts). Supports boolean operators, phrases in quotes, and proximity. Returns case names, citations, courts, dates, snippets and opinion ids for full-text retrieval via get_opinion_text.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query, e.g. '\"failure to warn\" AND PFAS' or 'consequential damages waiver indemnity'" },
      jurisdiction: { type: "string", description: "Named group: scotus, federal-appellate, 4th-circuit, 7th-circuit, 9th-circuit, 11th-circuit, california-state, new-york-state, delaware, texas-state, illinois-state. Omit for all courts." },
      courts: { type: "string", description: "Space-separated CourtListener court ids (e.g. 'ca4 dsc'), overrides jurisdiction" },
      filed_after: { type: "string", description: "YYYY-MM-DD" },
      filed_before: { type: "string", description: "YYYY-MM-DD" },
      order_by: { type: "string", description: "'score desc' (default), 'dateFiled desc', 'dateFiled asc', 'citeCount desc'" },
      limit: { type: "integer", description: "Max results, default 10, max 20" },
    },
    required: ["query"],
  },
  label: (a) => `Searching case law: ${a.query}`,
  async execute(args, ctx) {
    const params = new URLSearchParams({ q: args.query, type: "o", order_by: args.order_by ?? "score desc" });
    const courts = args.courts ?? (args.jurisdiction ? COURT_GROUPS[args.jurisdiction] : undefined);
    if (courts) params.set("court", courts);
    if (args.filed_after) params.set("filed_after", args.filed_after);
    if (args.filed_before) params.set("filed_before", args.filed_before);
    const data = await fetchJSON<CLSearchResult>(`${CL}/search/?${params}`, { headers: clHeaders(), signal: ctx.signal });
    const limit = Math.min(args.limit ?? 10, 20);
    const results = (data.results ?? []).slice(0, limit).map((r) => ({
      case_name: r.caseName,
      citations: r.citation ?? [],
      court: r.court,
      court_id: r.court_id,
      date_filed: r.dateFiled,
      docket_number: r.docketNumber,
      status: r.status,
      cite_count: r.citeCount,
      judge: r.judge,
      snippet: (r.opinions?.[0]?.snippet ?? r.snippet ?? "").replace(/\s+/g, " ").trim(),
      opinion_id: r.opinions?.[0]?.id,
      cluster_id: r.cluster_id,
      url: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : undefined,
    }));
    for (const r of results.slice(0, 5)) ctx.emit({ type: "citation", citation: { title: `${r.case_name}${r.citations?.[0] ? `, ${r.citations[0]}` : ""}`, url: r.url, cite: r.citations?.[0], source: "case law", snippet: r.snippet } });
    return { total: data.count ?? results.length, results };
  },
});

export const getOpinionTextTool = defineTool<{ opinion_id: number; max_chars?: number }>({
  name: "get_opinion_text",
  description: "Retrieve the full text of a court opinion by CourtListener opinion id (from search_case_law). Use it to verify holdings, quote accurately, and check pin cites.",
  parameters: { type: "object", properties: { opinion_id: { type: "integer" }, max_chars: { type: "integer", description: "Default 40000" } }, required: ["opinion_id"] },
  label: (a) => `Reading opinion #${a.opinion_id}`,
  async execute({ opinion_id, max_chars }, ctx) {
    const data = await fetchJSON<{ plain_text?: string; html_with_citations?: string; html?: string; html_lawbox?: string; html_columbia?: string; xml_harvard?: string; download_url?: string; absolute_url?: string; cluster?: string }>(`${CL}/opinions/${opinion_id}/`, { headers: clHeaders(), signal: ctx.signal });
    const raw = data.plain_text?.trim() || htmlToText(data.html_with_citations ?? data.html ?? data.html_lawbox ?? data.html_columbia ?? "").text || stripXml(data.xml_harvard ?? "");
    const max = max_chars ?? 40_000;
    return { opinion_id, url: data.absolute_url ? `https://www.courtlistener.com${data.absolute_url}` : undefined, text: raw.length > max ? raw.slice(0, max) + "\n…[truncated]" : raw, length: raw.length };
  },
});

export const searchDocketsTool = defineTool<{ query: string; courts?: string; filed_after?: string; filed_before?: string; limit?: number }>({
  name: "search_dockets",
  description: "Search federal court dockets (PACER/RECAP via CourtListener): case names, parties, nature of suit, assigned judge and filing dates. Use for docket monitoring, finding related litigation, or judge/party history.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "e.g. 'Meridian Fluorochem' or 'AFFF products liability'" },
      courts: { type: "string", description: "Space-separated court ids, e.g. 'dsc ilnd'" },
      filed_after: { type: "string" },
      filed_before: { type: "string" },
      limit: { type: "integer", description: "Default 10, max 20" },
    },
    required: ["query"],
  },
  label: (a) => `Searching dockets: ${a.query}`,
  async execute(args, ctx) {
    const params = new URLSearchParams({ q: args.query, type: "r", order_by: "dateFiled desc" });
    if (args.courts) params.set("court", args.courts);
    if (args.filed_after) params.set("filed_after", args.filed_after);
    if (args.filed_before) params.set("filed_before", args.filed_before);
    const data = await fetchJSON<CLSearchResult>(`${CL}/search/?${params}`, { headers: clHeaders(), signal: ctx.signal });
    const results = (data.results ?? []).slice(0, Math.min(args.limit ?? 10, 20)).map((r) => ({
      case_name: r.caseName,
      docket_number: r.docketNumber,
      court: r.court,
      court_id: r.court_id,
      date_filed: r.dateFiled,
      date_terminated: r.dateTerminated,
      assigned_to: r.assignedTo,
      nature_of_suit: r.suitNature,
      cause: r.cause,
      parties: r.party?.slice(0, 8),
      attorneys: r.attorney?.slice(0, 6),
      docket_id: r.docket_id,
      url: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : undefined,
    }));
    return { total: data.count ?? results.length, results };
  },
});

export const getDocketEntriesTool = defineTool<{ docket_id: number; limit?: number }>({
  name: "get_docket_entries",
  description: "List recent docket entries (filings) for a docket id returned by search_dockets, newest first.",
  parameters: { type: "object", properties: { docket_id: { type: "integer" }, limit: { type: "integer", description: "Default 25" } }, required: ["docket_id"] },
  label: (a) => `Reading docket #${a.docket_id}`,
  async execute({ docket_id, limit }, ctx) {
    const data = await fetchJSON<{ results?: Array<{ entry_number?: number; date_filed?: string; description?: string; recap_documents?: Array<{ description?: string; filepath_local?: string; absolute_url?: string; is_available?: boolean }> }> }>(
      `${CL}/docket-entries/?docket=${docket_id}&order_by=-date_filed&page_size=${Math.min(limit ?? 25, 50)}`,
      { headers: clHeaders(), signal: ctx.signal },
    );
    return { docket_id, entries: (data.results ?? []).map((e) => ({ entry: e.entry_number, date: e.date_filed, description: e.description?.slice(0, 600), documents: e.recap_documents?.slice(0, 3).map((d) => ({ description: d.description, available: d.is_available, url: d.absolute_url ? `https://www.courtlistener.com${d.absolute_url}` : undefined })) })) };
  },
});

export const verifyCitationsTool = defineTool<{ text: string }>({
  name: "verify_citations",
  description: "Extract every legal citation from a block of text and resolve each against CourtListener. Returns which citations resolve (with case name and court) and which do not, so hallucinated or mistyped cites can be flagged before filing.",
  parameters: { type: "object", properties: { text: { type: "string", description: "Text containing citations such as '550 U.S. 544' or '123 F.3d 456'" } }, required: ["text"] },
  label: () => "Verifying citations",
  async execute({ text }, ctx) {
    const body = new URLSearchParams({ text: text.slice(0, 60_000) });
    const data = await fetchJSON<Array<{ citation: string; normalized_citations?: string[]; status: number; error_message?: string; clusters?: Array<{ case_name?: string; absolute_url?: string; date_filed?: string; docket_id?: number }> }>>(`${CL}/citation-lookup/`, {
      method: "POST",
      headers: { ...clHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: ctx.signal,
    });
    return {
      citations: data.map((c) => ({
        citation: c.citation,
        resolved: c.status === 200 && (c.clusters?.length ?? 0) > 0,
        status: c.status,
        error: c.error_message,
        matches: c.clusters?.slice(0, 3).map((k) => ({ case_name: k.case_name, date_filed: k.date_filed, url: k.absolute_url ? `https://www.courtlistener.com${k.absolute_url}` : undefined })),
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Regulations: eCFR + Federal Register
// ---------------------------------------------------------------------------

export const searchRegulationsTool = defineTool<{ query: string; title?: number; agency_slug?: string; limit?: number }>({
  name: "search_cfr",
  description: "Full-text search of the current Code of Federal Regulations (eCFR). Returns matching sections with hierarchy (title/part/section), headings and excerpts. Use get_cfr_section to read a section.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "e.g. 'perfluorooctanoic acid drinking water MCL' or '\"substantial risk\" 8(e)'" },
      title: { type: "integer", description: "Restrict to a CFR title number, e.g. 40 (Environment), 21 (Food & Drugs), 29 (Labor), 17 (Securities)" },
      agency_slug: { type: "string", description: "eCFR agency slug, e.g. 'environmental-protection-agency'" },
      limit: { type: "integer", description: "Default 10, max 20" },
    },
    required: ["query"],
  },
  label: (a) => `Searching CFR: ${a.query}`,
  async execute(args, ctx) {
    const params = new URLSearchParams({ query: args.query, per_page: String(Math.min(args.limit ?? 10, 20)), page: "1", order: "relevance" });
    if (args.title) params.append("hierarchy[title]", String(args.title));
    if (args.agency_slug) params.append("agency_slugs[]", args.agency_slug);
    const data = await fetchJSON<{ results?: Array<{ hierarchy?: { title?: string; part?: string; section?: string; subpart?: string }; hierarchy_headings?: Record<string, string>; headings?: Record<string, string>; full_text_excerpt?: string; score?: number; starts_on?: string; type?: string }>; meta?: { total_count?: number } }>(`https://www.ecfr.gov/api/search/v1/results?${params}`, { signal: ctx.signal });
    const results = (data.results ?? []).map((r) => ({
      cite: r.hierarchy?.section ? `${r.hierarchy.title} C.F.R. § ${r.hierarchy.section}` : `${r.hierarchy?.title} C.F.R. Part ${r.hierarchy?.part}`,
      title: r.hierarchy?.title,
      part: r.hierarchy?.part,
      section: r.hierarchy?.section,
      heading: r.headings?.section ?? r.headings?.part,
      part_heading: r.headings?.part,
      excerpt: r.full_text_excerpt?.replace(/<\/?[^>]+>/g, "").replace(/\s+/g, " ").trim(),
      effective: r.starts_on,
      url: r.hierarchy?.section ? `https://www.ecfr.gov/current/title-${r.hierarchy.title}/section-${r.hierarchy.section}` : `https://www.ecfr.gov/current/title-${r.hierarchy?.title}/part-${r.hierarchy?.part}`,
    }));
    for (const r of results.slice(0, 4)) ctx.emit({ type: "citation", citation: { title: `${r.cite} — ${r.heading ?? ""}`, url: r.url, cite: r.cite, source: "regulation" } });
    return { total: data.meta?.total_count ?? results.length, results };
  },
});

export const getCfrSectionTool = defineTool<{ title: number; section: string; max_chars?: number }>({
  name: "get_cfr_section",
  description: "Read the current text of a CFR section, e.g. title 40 section '141.60'.",
  parameters: { type: "object", properties: { title: { type: "integer" }, section: { type: "string", description: "Section number like '141.60' or '720.3'" }, max_chars: { type: "integer" } }, required: ["title", "section"] },
  label: (a) => `Reading ${a.title} C.F.R. § ${a.section}`,
  async execute({ title, section, max_chars }, ctx) {
    const d = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
    const part = section.split(".")[0];
    const url = `https://www.ecfr.gov/api/versioner/v1/full/${d}/title-${title}.xml?part=${encodeURIComponent(part)}&section=${encodeURIComponent(section)}`;
    const { text } = await fetchText(url, { signal: ctx.signal });
    const body = stripXml(text);
    const max = max_chars ?? 30_000;
    return { cite: `${title} C.F.R. § ${section}`, url: `https://www.ecfr.gov/current/title-${title}/section-${section}`, as_of: d, text: body.length > max ? body.slice(0, max) + "\n…[truncated]" : body };
  },
});

export const searchFederalRegisterTool = defineTool<{ query: string; agency?: string; document_type?: string; published_after?: string; published_before?: string; limit?: number }>({
  name: "search_federal_register",
  description: "Search the Federal Register (proposed rules, final rules, notices, presidential documents). Returns titles, agencies, publication dates, citations, abstracts and links.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      agency: { type: "string", description: "Agency slug e.g. 'environmental-protection-agency', 'food-and-drug-administration', 'securities-and-exchange-commission'" },
      document_type: { type: "string", description: "RULE | PRORULE | NOTICE | PRESDOCU" },
      published_after: { type: "string", description: "YYYY-MM-DD" },
      published_before: { type: "string", description: "YYYY-MM-DD" },
      limit: { type: "integer", description: "Default 10, max 20" },
    },
    required: ["query"],
  },
  label: (a) => `Searching Federal Register: ${a.query}`,
  async execute(args, ctx) {
    const params = new URLSearchParams({ "conditions[term]": args.query, per_page: String(Math.min(args.limit ?? 10, 20)), order: "relevance" });
    if (args.agency) params.append("conditions[agencies][]", args.agency);
    if (args.document_type) params.append("conditions[type][]", args.document_type);
    if (args.published_after) params.set("conditions[publication_date][gte]", args.published_after);
    if (args.published_before) params.set("conditions[publication_date][lte]", args.published_before);
    for (const f of ["title", "type", "abstract", "document_number", "html_url", "pdf_url", "publication_date", "agencies", "citation", "effective_on", "comments_close_on", "docket_ids"]) params.append("fields[]", f);
    const data = await fetchJSON<{ count?: number; results?: Array<{ title: string; type: string; abstract?: string; document_number: string; html_url: string; pdf_url?: string; publication_date: string; agencies?: Array<{ name?: string; raw_name?: string }>; citation?: string; effective_on?: string; comments_close_on?: string; docket_ids?: string[] }> }>(`https://www.federalregister.gov/api/v1/documents.json?${params}`, { signal: ctx.signal });
    const results = (data.results ?? []).map((r) => ({ title: r.title, type: r.type, agencies: r.agencies?.map((a) => a.name ?? a.raw_name).filter(Boolean), published: r.publication_date, citation: r.citation, effective_on: r.effective_on, comments_close_on: r.comments_close_on, document_number: r.document_number, docket_ids: r.docket_ids, abstract: r.abstract?.slice(0, 800), url: r.html_url, pdf_url: r.pdf_url }));
    for (const r of results.slice(0, 4)) ctx.emit({ type: "citation", citation: { title: r.title, url: r.url, cite: r.citation, source: "federal register" } });
    return { total: data.count ?? results.length, results };
  },
});

export const getFederalRegisterDocumentTool = defineTool<{ document_number: string; max_chars?: number }>({
  name: "get_federal_register_document",
  description: "Read the full text of a Federal Register document by document number (e.g. '2024-07773').",
  parameters: { type: "object", properties: { document_number: { type: "string" }, max_chars: { type: "integer" } }, required: ["document_number"] },
  label: (a) => `Reading FR doc ${a.document_number}`,
  async execute({ document_number, max_chars }, ctx) {
    const meta = await fetchJSON<{ title: string; html_url: string; body_html_url?: string; full_text_xml_url?: string; raw_text_url?: string; publication_date?: string; citation?: string }>(`https://www.federalregister.gov/api/v1/documents/${encodeURIComponent(document_number)}.json`, { signal: ctx.signal });
    const src = meta.raw_text_url ?? meta.body_html_url ?? meta.full_text_xml_url;
    let text = "";
    if (src) {
      const r = await fetchText(src, { signal: ctx.signal });
      text = /xml/i.test(r.contentType) ? stripXml(r.text) : /html/i.test(r.contentType) ? htmlToText(r.text, { maxChars: 500_000 }).text : r.text;
    }
    const max = max_chars ?? 40_000;
    return { title: meta.title, citation: meta.citation, published: meta.publication_date, url: meta.html_url, text: text.length > max ? text.slice(0, max) + "\n…[truncated]" : text };
  },
});

// ---------------------------------------------------------------------------
// Statutes / legislative: GovInfo (U.S. Code, Public Laws, Congressional bills)
// ---------------------------------------------------------------------------

export const searchStatutesTool = defineTool<{ query: string; collection?: string; limit?: number }>({
  name: "search_statutes",
  description: "Search GovInfo for the U.S. Code (USCODE), Public Laws (PLAW), Statutes at Large (STATUTE), Congressional bills (BILLS) and CFR (CFR). Returns titles, package ids, dates and text/PDF links. Best for locating statutory sections such as '15 U.S.C. 2607(e)'.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "e.g. '15 U.S.C. 2607 substantial risk' or 'Toxic Substances Control Act section 8(e)'" },
      collection: { type: "string", description: "USCODE (default) | PLAW | STATUTE | BILLS | CFR | CRPT" },
      limit: { type: "integer", description: "Default 10, max 20" },
    },
    required: ["query"],
  },
  label: (a) => `Searching statutes: ${a.query}`,
  async execute(args, ctx) {
    const key = process.env.GOVINFO_API_KEY?.trim() || "DEMO_KEY";
    const collectionCode = (args.collection ?? "USCODE").toUpperCase();
    const data = await fetchJSON<{ count?: number; results?: Array<{ title?: string; packageId?: string; granuleId?: string; dateIssued?: string; collectionCode?: string; download?: { txtLink?: string; pdfLink?: string; xmlLink?: string }; resultLink?: string; teaser?: string }> }>(`https://api.govinfo.gov/search?api_key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `collection:${collectionCode} ${args.query}`, pageSize: Math.min(args.limit ?? 10, 20), offsetMark: "*", sorts: [{ field: "score", sortOrder: "DESC" }] }),
      signal: ctx.signal,
    });
    const results = (data.results ?? []).map((r) => ({ title: r.title, package_id: r.packageId, granule_id: r.granuleId, date: r.dateIssued, collection: r.collectionCode, teaser: r.teaser?.replace(/<[^>]+>/g, ""), text_url: r.download?.txtLink, pdf_url: r.download?.pdfLink, url: r.resultLink }));
    return { total: data.count ?? results.length, results, note: "Use fetch_url on text_url to read the section text." };
  },
});

export const LEGAL_TOOLS = [searchCaseLawTool, getOpinionTextTool, searchDocketsTool, getDocketEntriesTool, verifyCitationsTool, searchRegulationsTool, getCfrSectionTool, searchFederalRegisterTool, getFederalRegisterDocumentTool, searchStatutesTool];
