/** Pure list operations for the builder's front-end field editor (no React; tested directly). */
import { arrayMove } from "@dnd-kit/sortable";
import type { WorkflowFrontend, WorkflowFrontendField } from "@/lib/types/domain";
import { fieldKeyFor, type FrontendFieldType } from "../../frontend";

export function addField(fe: WorkflowFrontend, type: FrontendFieldType = "text", label = "New field"): WorkflowFrontend {
  const key = fieldKeyFor(label, fe.fields.map((f) => f.key));
  const field: WorkflowFrontendField = { key, label, type, required: type === "file" || type === "matter" };
  if (type === "file" || type === "files") field.accept = [".docx", ".pdf", ".txt", ".md"];
  if (type === "select" || type === "multiselect") field.options = ["Option A", "Option B"];
  return { ...fe, fields: [...fe.fields, field] };
}
export function removeField(fe: WorkflowFrontend, key: string): WorkflowFrontend { return { ...fe, fields: fe.fields.filter((f) => f.key !== key) }; }
export function moveField(fe: WorkflowFrontend, from: number, to: number): WorkflowFrontend {
  if (from === to || from < 0 || to < 0 || from >= fe.fields.length || to >= fe.fields.length) return fe;
  return { ...fe, fields: arrayMove(fe.fields, from, to) };
}
export function updateField(fe: WorkflowFrontend, key: string, patch: Partial<WorkflowFrontendField>): WorkflowFrontend {
  return { ...fe, fields: fe.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) };
}
/** Rename a field key, keeping it unique and safe for `inputs.<key>`. */
export function renameFieldKey(fe: WorkflowFrontend, key: string, next: string): WorkflowFrontend {
  const clean = next.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  if (!clean || clean === key) return fe;
  if (fe.fields.some((f) => f.key === clean)) return fe;
  return { ...fe, fields: fe.fields.map((f) => (f.key === key ? { ...f, key: clean } : f)) };
}
