import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { audit } from "@/lib/integrity/audit";
import { currentUser } from "@/lib/current-user";
import type { Story, StoryCiteReport, StoryFact, StorySummary } from "./types";
import { factsFromIntel, factsFromTestimony, factsFromTimeline, mergeFacts, renumberFacts, storyCsv, storyMarkdown, summarizeStory, verifyStoryCites, type CiteEvidenceSet } from "./stories";
import { listEvents } from "./service";
import { buildChronology } from "@/modules/intel/analysis/chronology";

const STORIES = "ediscovery_stories";
const stories = () => db().collection<Story>(STORIES);
const now = () => new Date().toISOString();
const userId = () => currentUser().id;

export function listStories(matterId: string): StorySummary[] {
  return stories().find((s) => s.matterId === matterId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summarizeStory);
}

export function getStory(id: string): Story | null {
  return stories().get(id);
}

export function createStory(matterId: string, input: { title: string; theme?: string; facts?: StoryFact[]; id?: string; meta?: Story["meta"] }): Story {
  if (!input.title?.trim()) throw Object.assign(new Error("`title` is required"), { status: 400 });
  const t = now();
  const s: Story = { id: input.id ?? `story_${nanoid(10)}`, matterId, title: input.title.trim(), theme: input.theme?.trim() || undefined, facts: renumberFacts(input.facts ?? []), createdAt: t, updatedAt: t, createdBy: userId(), meta: input.meta };
  stories().put(s);
  audit("create", { kind: "story", id: s.id, label: s.title, matterId }, { facts: s.facts.length });
  return s;
}

export function updateStory(id: string, patch: Partial<Pick<Story, "title" | "theme" | "facts" | "narrative">>): Story | null {
  return stories().update(id, (s) => ({ ...s, ...patch, facts: patch.facts ? renumberFacts(patch.facts) : s.facts, updatedAt: now() }));
}

export function deleteStory(id: string) {
  const s = stories().get(id);
  const ok = stories().delete(id);
  if (s) audit("delete", { kind: "story", id, label: s.title, matterId: s.matterId }, {});
  return ok;
}

/** Add, replace or remove one fact. `fact.id` absent → new fact; `remove` → delete. */
export function upsertFact(storyId: string, fact: Partial<StoryFact> & { id?: string }, opts: { remove?: boolean } = {}): Story | null {
  return stories().update(storyId, (s) => {
    let facts = s.facts;
    if (opts.remove && fact.id) facts = facts.filter((f) => f.id !== fact.id);
    else if (fact.id && facts.some((f) => f.id === fact.id)) facts = facts.map((f) => (f.id === fact.id ? { ...f, ...fact, id: f.id } as StoryFact : f));
    else {
      if (!fact.text?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fact.date ?? "")) throw Object.assign(new Error("A fact needs `text` and an ISO `date`"), { status: 400 });
      facts = [...facts, { id: fact.id ?? `sf_${nanoid(8)}`, order: facts.length + 1, date: fact.date!, dateEnd: fact.dateEnd, precision: fact.precision ?? "day", text: fact.text.trim(), evidence: fact.evidence ?? [], confidence: typeof fact.confidence === "number" ? Math.max(0, Math.min(1, fact.confidence)) : 0.8, disputed: !!fact.disputed, origin: fact.origin ?? "user", originId: fact.originId, personIds: fact.personIds, tags: fact.tags, verified: !!fact.verified }];
    }
    return { ...s, facts: renumberFacts(facts), updatedAt: now() };
  });
}

/** Merge facts into a story (dedupe + evidence union); returns the story and what changed. */
export function addFacts(storyId: string, incoming: StoryFact[]): { story: Story; added: number; merged: number } | null {
  const s = stories().get(storyId);
  if (!s) return null;
  const res = mergeFacts(s.facts, incoming);
  const next = { ...s, facts: res.facts, updatedAt: now() };
  stories().put(next);
  audit("update", { kind: "story", id: s.id, label: s.title, matterId: s.matterId }, { added: res.added.length, merged: res.merged.length, origin: incoming[0]?.origin });
  return { story: next, added: res.added.length, merged: res.merged.length };
}

export interface BuildStoryInput {
  from: "timeline" | "testimony" | "intel";
  /** timeline: significance floor; testimony: deposition ids (all transcribed when empty) and flags; intel: confidence floor. */
  minSignificance?: number;
  depositionIds?: string[];
  flags?: ("admission" | "contradiction" | "evasive" | "key" | "privilege")[];
  minConfidence?: number;
  from_?: string;
  to?: string;
}

/** Deterministic fact set from the record (no model): chronology events, flagged testimony, or the intelligence chronology. */
export function buildFacts(matterId: string, input: BuildStoryInput): StoryFact[] {
  const d = db();
  if (input.from === "timeline") {
    const events = listEvents(matterId, { minSignificance: input.minSignificance, from: input.from_, to: input.to });
    const names = new Map(d.depositions.find((x) => x.matterId === matterId).map((x) => [x.id, x.witnessName]));
    return factsFromTimeline(events, { witnessNames: names });
  }
  if (input.from === "testimony") {
    const deps = d.depositions.find((x) => x.matterId === matterId && x.transcript.length > 0 && (!input.depositionIds?.length || input.depositionIds.includes(x.id)));
    return renumberFacts(deps.flatMap((dep) => factsFromTestimony(dep, { flags: input.flags })));
  }
  // intel: the analysis module owns the chronology; degrade to an empty list when it is unavailable.
  try {
    const res = buildChronology({ matterId, includeEdiscovery: false, from: input.from_, to: input.to });
    return factsFromIntel(res.entries, { minConfidence: input.minConfidence ?? 0.5 });
  } catch {
    return [];
  }
}

export function buildStory(matterId: string, input: BuildStoryInput & { title?: string; storyId?: string; theme?: string }): { story: Story; added: number; merged: number; built: number } {
  const facts = buildFacts(matterId, input);
  if (input.storyId) {
    const r = addFacts(input.storyId, facts);
    if (!r) throw Object.assign(new Error(`No story ${input.storyId}`), { status: 404 });
    return { ...r, built: facts.length };
  }
  const label = input.from === "timeline" ? "chronology" : input.from === "testimony" ? "testimony" : "intelligence chronology";
  const story = createStory(matterId, { title: input.title?.trim() || `Story from ${label}`, theme: input.theme, facts });
  return { story, added: facts.length, merged: 0, built: facts.length };
}

/** Evidence set for cite verification: every Bates in the matter, transcript pages per deposition, intel record ids, event ids. */
export function citeEvidenceFor(matterId: string): CiteEvidenceSet {
  const d = db();
  const bates = new Set<string>();
  for (const x of d.edocs.find((e) => e.matterId === matterId)) { bates.add(x.bates.toUpperCase()); if (x.batesEnd) bates.add(x.batesEnd.toUpperCase()); }
  const pagesByDeposition = new Map<string, Set<number>>();
  for (const dep of d.depositions.find((x) => x.matterId === matterId)) pagesByDeposition.set(dep.id, new Set(dep.transcript.map((q) => q.page)));
  let intelDocIds: Set<string> | undefined;
  try { intelDocIds = new Set(d.collection<{ id: string }>("intel_documents").all().map((x) => x.id)); } catch { intelDocIds = undefined; }
  const eventIds = new Set(d.timeline.find((e) => e.matterId === matterId).map((e) => e.id));
  return { bates, pagesByDeposition, intelDocIds, eventIds };
}

/** Verify every cite in the story against the record and mark facts verified / unverified accordingly. */
export function verifyStory(storyId: string): { story: Story; report: StoryCiteReport } | null {
  const s = stories().get(storyId);
  if (!s) return null;
  const report = verifyStoryCites(s, citeEvidenceFor(s.matterId));
  const bad = new Set(report.unresolved.map((u) => u.factId));
  const facts = s.facts.map((f) => ({ ...f, verified: f.evidence.length > 0 && !bad.has(f.id) }));
  const next = { ...s, facts, updatedAt: now() };
  stories().put(next);
  audit("ai.verify", { kind: "story", id: s.id, label: s.title, matterId: s.matterId }, { method: "citations", checked: report.checked, resolved: report.resolved, unresolved: report.unresolved.length });
  return { story: next, report };
}

export function storyExport(storyId: string, format: "csv" | "markdown"): { filename: string; body: string; title: string } | null {
  const s = stories().get(storyId);
  if (!s) return null;
  const matter = db().matters.get(s.matterId);
  const people = new Map(db().people.all().map((p) => [p.id, p.name]));
  const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  audit("export", { kind: "story", id: s.id, label: s.title, matterId: s.matterId }, { format, facts: s.facts.length });
  if (format === "csv") return { filename: `story-${slug}.csv`, body: storyCsv(s), title: s.title };
  return { filename: `story-${slug}.md`, body: storyMarkdown(s, { matterName: matter?.name, people }), title: s.title };
}

/** Testimony and documents the story cites, for prompts and drawers. */
export function storySources(s: Story) {
  const d = db();
  const docs = new Map<string, { id: string; bates: string; subject: string; date: string }>();
  const deps = new Map<string, { id: string; witnessName: string; indexes: Set<number> }>();
  for (const f of s.facts) for (const e of f.evidence) {
    if (e.kind === "document") { const doc = e.docId ? d.edocs.get(e.docId) : d.edocs.findOne((x) => x.bates.toUpperCase() === e.bates.toUpperCase()); if (doc) docs.set(doc.id, { id: doc.id, bates: doc.bates, subject: doc.subject, date: doc.date }); }
    if (e.kind === "testimony") { const dep = d.depositions.get(e.depositionId); if (dep) { const cur = deps.get(dep.id) ?? { id: dep.id, witnessName: dep.witnessName, indexes: new Set<number>() }; dep.transcript.forEach((qa, i) => { if (qa.page === e.page || (e.endPage != null && qa.page > e.page && qa.page <= e.endPage)) cur.indexes.add(i); }); deps.set(dep.id, cur); } }
  }
  return { docs: Array.from(docs.values()), depositions: Array.from(deps.values()).map((x) => ({ ...x, indexes: Array.from(x.indexes).sort((a, b) => a - b) })) };
}
