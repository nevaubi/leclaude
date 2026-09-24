/**
 * Workflow front ends: the one-page start form a template ships with. Pure and
 * client-safe. A front end's fields map onto `inputs.<key>`; files arrive as
 * `inputs.<key>` (the extracted text, so AI steps can read it) plus
 * `inputs.<key>_file` ({ blobId, name, mime, size, pages?, truncated? }); a
 * multi-file field arrives as an array of { blobId, name, mime, size, text }
 * under `inputs.<key>` plus `inputs.<key>_text` (all texts joined with headings).
 * Output choices land in `inputs.output_format`, `inputs.output_label` and
 * `inputs.output_folder` so `output.file` steps can honour them.
 */
import type { Workflow, WorkflowFrontend, WorkflowFrontendField } from "@/lib/types/domain";

export type FrontendFieldType = WorkflowFrontendField["type"];
export type OutputFormat = NonNullable<NonNullable<WorkflowFrontend["output"]>["formats"]>[number];
type WorkflowInput = NonNullable<Workflow["inputs"]>[number];

export const OUTPUT_FORMATS: OutputFormat[] = ["docx", "xlsx", "pdf", "csv", "md", "pptx"];
export const OUTPUT_FORMAT_LABEL: Record<OutputFormat, string> = { docx: "Word (.docx)", xlsx: "Workbook (.xlsx)", pdf: "PDF", csv: "CSV", md: "Markdown", pptx: "Slides (.pptx)" };
export const OUTPUT_INPUT_KEYS = { format: "output_format", label: "output_label", folder: "output_folder" } as const;

export const FRONTEND_FIELD_TYPES: { value: FrontendFieldType; label: string; hint: string }[] = [
  { value: "file", label: "File", hint: "One upload; text is extracted" },
  { value: "files", label: "Files", hint: "Several uploads" },
  { value: "text", label: "Text", hint: "Single line" },
  { value: "textarea", label: "Long text", hint: "Paragraphs" },
  { value: "select", label: "Select", hint: "One of a list" },
  { value: "multiselect", label: "Multi-select", hint: "Several of a list" },
  { value: "toggle", label: "Toggle", hint: "Yes / no" },
  { value: "date", label: "Date", hint: "YYYY-MM-DD" },
  { value: "number", label: "Number", hint: "" },
  { value: "matter", label: "Matter", hint: "Sets the run's matter" },
  { value: "person", label: "Person", hint: "Firm people" },
  { value: "library-folder", label: "Library folder", hint: "Destination folder" },
  { value: "bates-prefix", label: "Bates prefix", hint: "e.g. MFC-" },
  { value: "output-format", label: "Output format", hint: "docx / xlsx / pdf…" },
  { value: "label", label: "Label", hint: "Name for the output" },
];

/** Default accept list for file fields (matches the text extractor). */
export const DEFAULT_ACCEPT = [".docx", ".pdf", ".txt", ".md", ".csv", ".json", ".xlsx", ".pptx", ".html"];

export interface UploadedFileValue { blobId: string; name: string; mime: string; size: number; text?: string; method?: string; pages?: number; truncated?: boolean }

export interface FrontendValidationError { key: string; message: string }

export function isUploadedFile(v: unknown): v is UploadedFileValue {
  return Boolean(v && typeof v === "object" && typeof (v as UploadedFileValue).blobId === "string" && (v as UploadedFileValue).blobId.length > 0);
}

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** True when a file name / MIME type matches an accept list ([".pdf", "application/pdf", "image/*"]). Empty list accepts everything. */
export function fileAccepted(name: string, mime: string | undefined, accept: string[] | undefined): boolean {
  if (!accept?.length) return true;
  const e = ext(name);
  const m = (mime ?? "").toLowerCase();
  return accept.some((a) => {
    const t = a.trim().toLowerCase();
    if (!t) return false;
    if (t.startsWith(".")) return e === t;
    if (t.endsWith("/*")) return m.startsWith(t.slice(0, -1));
    return m === t;
  });
}

export function fieldDefault(f: WorkflowFrontendField): unknown {
  if (f.default !== undefined) return f.default;
  switch (f.type) {
    case "files": case "multiselect": return [];
    case "toggle": return false;
    case "select": return "";
    case "output-format": return "";
    default: return "";
  }
}

function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && !isUploadedFile(v) && Object.keys(v as object).length === 0);
}

/**
 * Validate front-end values. Accepts either the page's raw values (files as
 * UploadedFileValue) or the mapped inputs (file text under the key plus
 * `<key>_file`), so the engine can run the same check at start.
 */
export function validateFrontendValues(frontend: Pick<WorkflowFrontend, "fields"> | undefined | null, values: Record<string, unknown>): FrontendValidationError[] {
  const errors: FrontendValidationError[] = [];
  for (const f of frontend?.fields ?? []) {
    const v = values[f.key];
    const sidecar = values[`${f.key}_file`];
    if (f.type === "file") {
      const file = isUploadedFile(v) ? v : isUploadedFile(sidecar) ? sidecar : null;
      const hasText = typeof v === "string" && v.trim().length > 0;
      if (f.required && !file && !hasText) { errors.push({ key: f.key, message: "Upload a file or paste the text" }); continue; }
      if (file && !fileAccepted(file.name, file.mime, f.accept)) errors.push({ key: f.key, message: `${file.name}: accepted types are ${(f.accept ?? []).join(", ")}` });
      continue;
    }
    if (f.type === "files") {
      const list = Array.isArray(v) ? v.filter(isUploadedFile) : [];
      if (f.required && !list.length) { errors.push({ key: f.key, message: "Upload at least one file" }); continue; }
      for (const file of list) if (!fileAccepted(file.name, file.mime, f.accept)) errors.push({ key: f.key, message: `${file.name}: accepted types are ${(f.accept ?? []).join(", ")}` });
      continue;
    }
    if (f.required && isEmpty(v)) { errors.push({ key: f.key, message: "Required" }); continue; }
    if (isEmpty(v)) continue;
    switch (f.type) {
      case "number": if (!Number.isFinite(Number(v))) errors.push({ key: f.key, message: "Enter a number" }); break;
      case "date": if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors.push({ key: f.key, message: "Use YYYY-MM-DD" }); break;
      case "select": if (f.options?.length && !f.options.includes(String(v))) errors.push({ key: f.key, message: `Choose one of ${f.options.join(", ")}` }); break;
      case "multiselect": { const arr = Array.isArray(v) ? v.map(String) : String(v).split(",").map((s) => s.trim()).filter(Boolean); if (f.options?.length && arr.some((x) => !f.options!.includes(x))) errors.push({ key: f.key, message: `Choose from ${f.options.join(", ")}` }); break; }
      case "output-format": if (!OUTPUT_FORMATS.includes(String(v) as OutputFormat)) errors.push({ key: f.key, message: `Choose one of ${OUTPUT_FORMATS.join(", ")}` }); break;
      case "bates-prefix": if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/.test(String(v))) errors.push({ key: f.key, message: "Letters, digits, - and _ only" }); break;
      default: break;
    }
  }
  return errors;
}

/** Joined text of several uploads with a heading per file, capped so prompts stay bounded. */
export function joinFileTexts(files: UploadedFileValue[], cap = 400_000): string {
  let out = "";
  for (const f of files) {
    const chunk = `## ${f.name}\n\n${f.text ?? ""}\n\n`;
    if (out.length + chunk.length > cap) { out += chunk.slice(0, Math.max(0, cap - out.length)); break; }
    out += chunk;
  }
  return out.trim();
}

export interface MappedFrontendValues { inputs: Record<string, unknown>; matterId: string | null }

/** Map page values onto run inputs (see the module comment for the contract). */
export function mapFrontendValues(frontend: WorkflowFrontend | undefined | null, values: Record<string, unknown>): MappedFrontendValues {
  const inputs: Record<string, unknown> = {};
  let matterId: string | null = null;
  for (const f of frontend?.fields ?? []) {
    const v = values[f.key];
    switch (f.type) {
      case "file": {
        if (isUploadedFile(v)) { inputs[f.key] = v.text ?? ""; inputs[`${f.key}_file`] = { blobId: v.blobId, name: v.name, mime: v.mime, size: v.size, pages: v.pages, truncated: v.truncated }; }
        else if (typeof v === "string") inputs[f.key] = v;
        else inputs[f.key] = "";
        break;
      }
      case "files": {
        const list = (Array.isArray(v) ? v : []).filter(isUploadedFile);
        inputs[f.key] = list.map((x) => ({ blobId: x.blobId, name: x.name, mime: x.mime, size: x.size, text: x.text ?? "", pages: x.pages, truncated: x.truncated }));
        inputs[`${f.key}_text`] = joinFileTexts(list);
        break;
      }
      case "number": inputs[f.key] = v === "" || v == null ? undefined : Number(v); break;
      case "toggle": inputs[f.key] = typeof v === "string" ? ["true", "yes", "1", "on"].includes(v.toLowerCase()) : Boolean(v); break;
      case "multiselect": inputs[f.key] = Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []; break;
      case "matter": { const id = typeof v === "string" ? v : ""; inputs[f.key] = id; if (id && !matterId) matterId = id; break; }
      case "output-format": inputs[f.key] = typeof v === "string" ? v : ""; if (typeof v === "string" && v && !(OUTPUT_INPUT_KEYS.format in values)) inputs[OUTPUT_INPUT_KEYS.format] = v; break;
      case "label": inputs[f.key] = typeof v === "string" ? v : ""; if (typeof v === "string" && v && !(OUTPUT_INPUT_KEYS.label in values)) inputs[OUTPUT_INPUT_KEYS.label] = v; break;
      case "library-folder": inputs[f.key] = typeof v === "string" ? v : ""; if (typeof v === "string" && v && !(OUTPUT_INPUT_KEYS.folder in values)) inputs[OUTPUT_INPUT_KEYS.folder] = v; break;
      default: inputs[f.key] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v;
    }
  }
  // Output section of the page (format / label / folder) and any extra keys the caller passed through.
  for (const key of Object.values(OUTPUT_INPUT_KEYS)) if (values[key] !== undefined && values[key] !== "" && inputs[key] === undefined) inputs[key] = values[key];
  if (!matterId && typeof values.matterId === "string" && values.matterId) matterId = values.matterId;
  return { inputs, matterId };
}

/** Nearest legacy input type for a front-end field (keeps `workflow.inputs`, the run dialog and the AI builder in sync). */
export function inputTypeForField(type: FrontendFieldType): WorkflowInput["type"] {
  switch (type) {
    case "file": case "files": return "file";
    case "textarea": return "textarea";
    case "select": case "multiselect": case "output-format": return "select";
    case "toggle": return "select";
    case "date": return "date";
    case "number": return "number";
    case "matter": return "matter";
    default: return "text";
  }
}

/** Derive `workflow.inputs` from a front end so the engine's required-input check and older UIs keep working. */
export function syncInputsFromFrontend(frontend: Pick<WorkflowFrontend, "fields">): WorkflowInput[] {
  return frontend.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: inputTypeForField(f.type),
    required: f.required,
    options: f.type === "toggle" ? ["true", "false"] : f.type === "output-format" ? [...(OUTPUT_FORMATS as readonly string[])] : f.options,
    placeholder: f.placeholder,
  }));
}

/** A front end derived from legacy `workflow.inputs` (used when a workflow has none of its own). */
export function frontendFromInputs(workflow: Pick<Workflow, "name" | "description" | "inputs">): WorkflowFrontend {
  return {
    title: workflow.name,
    intro: workflow.description,
    fields: (workflow.inputs ?? []).map((i) => ({ key: i.key, label: i.label, type: i.type === "file" ? "file" : i.type, required: i.required, placeholder: i.placeholder, options: i.options, accept: i.type === "file" ? DEFAULT_ACCEPT : undefined })),
    submitLabel: "Run",
  };
}

export function frontendFor(workflow: Pick<Workflow, "name" | "description" | "inputs" | "frontend">): WorkflowFrontend {
  return workflow.frontend?.fields ? workflow.frontend : frontendFromInputs(workflow);
}

export function emptyFrontend(name = "Start"): WorkflowFrontend {
  return { title: name, intro: "", fields: [], submitLabel: "Run", output: { formats: ["docx"], defaultFormat: "docx" }, after: {} };
}

/** snake_case key from a label, unique among `existing`. */
export function fieldKeyFor(label: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "_$1") || "field";
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/** Group fields under their `group` heading, preserving order. */
export function groupFields(fields: WorkflowFrontendField[]): { group: string | undefined; fields: WorkflowFrontendField[] }[] {
  const out: { group: string | undefined; fields: WorkflowFrontendField[] }[] = [];
  for (const f of fields) {
    const last = out[out.length - 1];
    if (last && last.group === f.group) last.fields.push(f); else out.push({ group: f.group, fields: [f] });
  }
  return out;
}
