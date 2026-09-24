import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { audit } from "@/lib/integrity/audit";
import { currentUser } from "@/lib/current-user";
import type { Deposition, Person } from "@/lib/types/domain";
import type { ParsedTranscript, TranscriptImportRecord } from "./types";
import { parseTranscript, type ParseOptions } from "./transcript-import";
import { resolvePersonName } from "./graph";

const IMPORTS = "ediscovery_transcript_imports";
const imports = () => db().collection<TranscriptImportRecord>(IMPORTS);

/** Decode an uploaded transcript: .txt/.ptx/.asc as text, .docx through mammoth. */
export async function extractTranscriptText(bytes: Uint8Array, name: string | undefined, mime: string | undefined): Promise<{ text: string; sourceKind: TranscriptImportRecord["sourceKind"] }> {
  const ext = (name ?? "").toLowerCase().split(".").pop() ?? "";
  if (ext === "docx" || /wordprocessingml/.test(mime ?? "")) {
    const mammoth = (await import("mammoth")).default;
    const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { text: r.value, sourceKind: "docx" };
  }
  if (ext === "doc" || ext === "pdf") throw Object.assign(new Error(`.${ext} transcripts are not supported; export the transcript as .txt, .ptx or .docx`), { status: 415 });
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return { text: text.replace(/^﻿/, ""), sourceKind: ext === "ptx" ? "ptx" : "txt" };
}

export interface ImportTranscriptInput {
  matterId: string;
  text: string;
  witnessName?: string;
  witnessId?: string;
  witnessTitle?: string;
  date?: string;
  takenBy?: string;
  defendingBy?: string;
  location?: string;
  volume?: number;
  exhibits?: Deposition["exhibits"];
  sourceName?: string;
  sourceKind?: TranscriptImportRecord["sourceKind"];
  speakers?: Record<string, string>;
  firstPage?: number;
  /** Replace an existing deposition's transcript instead of creating one. */
  depositionId?: string;
}

/** Parse only; nothing is written. */
export function previewTranscript(text: string, opts: ParseOptions = {}): ParsedTranscript {
  return parseTranscript(text, opts);
}

/**
 * Parse the text and create (or replace) the deposition. A witness who is not
 * yet a person on the matter is created with role "witness" so the people graph
 * and cross-analysis see them. The parse report is kept as an import record.
 */
export function importTranscript(input: ImportTranscriptInput): { deposition: Deposition; parsed: ParsedTranscript; record: TranscriptImportRecord; created: boolean } {
  const d = db();
  if (!d.matters.get(input.matterId)) throw Object.assign(new Error(`Unknown matter ${input.matterId}`), { status: 404 });
  const parsed = parseTranscript(input.text, { firstPage: input.firstPage, speakers: input.speakers });
  if (!parsed.transcript.length) throw Object.assign(new Error("No Q/A pairs could be parsed from the transcript"), { status: 422 });
  const witnessName = (input.witnessName ?? parsed.meta.witnessName ?? "").trim();
  if (!witnessName) throw Object.assign(new Error("`witnessName` is required (the header did not name the witness)"), { status: 400 });
  const people = d.people.all();
  let person: Person | null = input.witnessId ? d.people.get(input.witnessId) : resolvePersonName(witnessName, people) ?? null;
  if (!person) {
    person = { id: `p_${nanoid(8)}`, name: witnessName, title: input.witnessTitle, role: "witness" };
    d.people.put(person);
  }
  const date = input.date ?? parsed.meta.date ?? new Date().toISOString().slice(0, 10);
  const existing = input.depositionId ? d.depositions.get(input.depositionId) : null;
  const id = existing?.id ?? `dep_${nanoid(10)}`;
  const exhibits = [...(input.exhibits ?? existing?.exhibits ?? [])];
  for (const ex of parsed.exhibits) if (!exhibits.some((e) => e.id.toLowerCase() === ex.id.toLowerCase())) exhibits.push(ex);
  const dep: Deposition = {
    id, matterId: input.matterId, witnessId: person.id, witnessName: person.name, witnessTitle: input.witnessTitle ?? existing?.witnessTitle ?? person.title,
    date, takenBy: input.takenBy ?? parsed.meta.takenBy ?? existing?.takenBy ?? "Examining counsel", defendingBy: input.defendingBy ?? parsed.meta.defendingBy ?? existing?.defendingBy, location: input.location ?? existing?.location,
    volume: input.volume ?? parsed.meta.volume ?? existing?.volume ?? 1, pages: Math.max(parsed.pages, existing?.pages ?? 0), transcript: parsed.transcript, exhibits, status: "transcribed",
  };
  d.depositions.put(dep);
  const record: TranscriptImportRecord = { id: `timp_${nanoid(8)}`, matterId: input.matterId, depositionId: id, sourceName: input.sourceName, sourceKind: input.sourceKind ?? "paste", format: parsed.format, confidence: parsed.confidence, issues: parsed.issues, qaCount: parsed.transcript.length, pages: parsed.pages, importedAt: new Date().toISOString(), importedBy: currentUser().id };
  imports().put(record);
  audit("import", { kind: "deposition", id, label: `${dep.witnessName} transcript`, matterId: input.matterId }, { format: parsed.format, confidence: parsed.confidence, qa: parsed.transcript.length, pages: parsed.pages, issues: parsed.issues.length, source: input.sourceName, replaced: !!existing });
  return { deposition: dep, parsed, record, created: !existing };
}

export function listImports(matterId: string): TranscriptImportRecord[] {
  return imports().find((r) => r.matterId === matterId).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export function importFor(depositionId: string): TranscriptImportRecord | null {
  return imports().find((r) => r.depositionId === depositionId).sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0] ?? null;
}
