/**
 * Stale-proposal detection (constitution §31/§44). Every Word proposal carries the hash of each target block as
 * the agent last read it (`payload.base.blocks`). Before applying, the editor recomputes the hashes from the live
 * document: unchanged → fresh; changed → rebased when the edit is anchored to text that still exists (phrase
 * replacements, formatting, comments on a quote, inserts next to a block), otherwise stale and rejected.
 * Pure and isomorphic: the same function runs in the editor and in tests.
 */
import { blockHash } from "./doc-model";

export interface LiveBlock { type: string; level?: number; text: string }
export type Freshness = { status: "fresh" } | { status: "rebased"; reason: string } | { status: "stale"; reason: string };

export interface ProposalBase { version?: string; blocks?: Record<string, string> }

/** Kinds that only use their target as a position anchor: a changed target is still a valid place to insert. */
const ANCHOR_ONLY = new Set(["insert_after", "insert_before", "insert_table_after", "insert_toc_after", "apply_template_section", "insert_page_break_after", "insert_image_after", "insert_diagram_after", "move_block", "set_page_setup", "insert_cross_reference", "numbering_fix", "renumber_lists", "set_alignment", "set_style", "set_heading_level", "accept_reject_changes", "resolve_comment", "merge_cells", "update_fields", "set_document_title"]);
/** Kinds anchored to a phrase that must still be present in the (changed) target. */
const PHRASE_KEY: Record<string, string> = { replace_text_in_paragraph: "find", format_text: "find", insert_footnote: "anchorText", add_comment: "quote", find_replace_all: "find" };

function contains(text: string, needle: string, regex: boolean, caseSensitive: boolean): boolean {
  if (!needle) return true;
  if (regex) { try { return new RegExp(needle, caseSensitive ? "u" : "iu").test(text); } catch { return false; } }
  return caseSensitive ? text.includes(needle) : text.toLowerCase().includes(needle.toLowerCase());
}

export function checkFreshness(kind: string, payload: Record<string, unknown>, lookup: (id: string) => LiveBlock | null): Freshness {
  const base = payload.base as ProposalBase | undefined;
  const targets = Object.entries(base?.blocks ?? {});
  if (!targets.length) return { status: "fresh" }; // proposals from older clients carry no base
  const changed: string[] = [];
  for (const [id, hash] of targets) {
    const live = lookup(id);
    if (!live) {
      if (kind === "find_replace_all") { changed.push(id); continue; }
      return { status: "stale", reason: `the target paragraph (${id}) no longer exists` };
    }
    if (blockHash(live) !== hash) changed.push(id);
  }
  if (!changed.length) return { status: "fresh" };
  if (kind === "rewrite_paragraph" || kind === "edit_table_cell") {
    const live = lookup(changed[0]);
    if (live && typeof payload.text === "string" && live.text.trim() === String(payload.text).trim()) return { status: "rebased", reason: "already applied" };
    return { status: "stale", reason: "the paragraph changed after the assistant read it" };
  }
  if (kind === "delete_paragraph" || kind === "redline_block") return { status: "stale", reason: "the paragraph changed after the assistant read it" };
  if (ANCHOR_ONLY.has(kind)) return { status: "rebased", reason: "target changed; applied at the same position" };
  const key = PHRASE_KEY[kind];
  if (key) {
    const needle = String(payload[key] ?? "");
    const regex = Boolean(payload.regex), cs = Boolean(payload.caseSensitive);
    const missing = changed.filter((id) => { const live = lookup(id); return !live || !contains(live.text, needle, regex, cs); });
    if (kind === "find_replace_all") {
      if (missing.length === targets.length) return { status: "stale", reason: `"${needle}" is no longer in the document` };
      return { status: "rebased", reason: `${changed.length - missing.length} changed paragraph(s) still contain the phrase` };
    }
    if (missing.length) return { status: "stale", reason: `"${needle.slice(0, 60)}" is no longer in the paragraph` };
    return { status: "rebased", reason: "paragraph changed; the phrase is still present" };
  }
  return { status: "stale", reason: "the document changed after the assistant read it" };
}
