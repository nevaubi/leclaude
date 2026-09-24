import "server-only";
import { db, type Database } from "@/lib/db";
import { INTEL_SEED_VERSION, ensureIntelSeeded } from "../seed";
import { intelDocuments } from "../store";
import { rebuildEntities } from "./entities";
import { buildRelations } from "./graph";
import { runAnalysis } from "./insights";

/**
 * Analysis seed: derive entities, relations, insights and chronologies from
 * the seeded intel corpus so /intel, Home and Settings render offline. Runs
 * after the intel seeder (registered in the seed registry) and lazily from the
 * analysis bootstrap for databases created before it existed. Idempotent:
 * every record has a stable id and re-runs merge in place.
 */
export const INTEL_ANALYSIS_SEED_VERSION = 1;
const KEY = "intel:analysis:seed:version";

/** Fixed clock for the seed so insight timestamps are stable across re-seeds of the same corpus. */
function seedClock(database: Database): Date {
  const latest = database.collection<{ id: string; updatedAt: string }>("intel_documents").all().map((d) => d.updatedAt).sort().pop();
  return latest ? new Date(latest) : new Date();
}

export function seedIntelAnalysis(database: Database): void {
  // The intel seeder normally ran just before this one; make sure the corpus exists either way.
  if (database.kv.get<number>("intel:seed:version") !== INTEL_SEED_VERSION) ensureIntelSeeded(database);
  if (!intelDocuments().count()) return;
  const now = seedClock(database);
  rebuildEntities({ now: now.toISOString() });
  buildRelations({ now: now.toISOString() });
  runAnalysis({ now, full: false, enqueueVerify: false, audit: false });
  database.kv.set(KEY, INTEL_ANALYSIS_SEED_VERSION);
}

/** Seed the analysis layer on databases that predate it (cheap kv check). */
export function ensureIntelAnalysisSeeded(database: Database = db()): boolean {
  if (database.kv.get<number>(KEY) === INTEL_ANALYSIS_SEED_VERSION) return false;
  seedIntelAnalysis(database);
  return true;
}
