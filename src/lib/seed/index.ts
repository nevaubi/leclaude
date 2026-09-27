import "server-only";
import type { Database } from "@/lib/db";
import { seedCore } from "./core";
import { seedHome } from "@/modules/home/seed";
import { seedEdiscovery } from "@/modules/ediscovery/seed";
import { seedWorkflows } from "@/modules/workflows/seed";
import { seedLibrary } from "@/modules/library/seed";
import { seedOffice } from "@/modules/office/shared/seed";
import { seedSearch } from "@/modules/search/seed";
import { seedIntel } from "@/modules/intel/seed";
import { seedIntelAnalysis } from "@/modules/intel/analysis/seed";
import { buildTemplates } from "@/modules/workflows/templates";
import { buildSystemTemplates } from "@/modules/workflows/templates-system";

/**
 * Seed registry. Bump SEED_VERSION when seed content changes materially; the
 * seeders run in order and must be idempotent (use putMany with stable ids).
 *
 * Two modes (LECLAUDE_SEED):
 * - "reference" (default): only genuine reference data, the workflow template gallery and the
 *   system workflows. A production workspace starts empty and is set up at /setup.
 * - "demo": the full sample dataset (matters, documents, depositions, people, runs, intel
 *   corpus). Used by the test suite and for demonstrations; never enabled implicitly.
 */
export const SEED_VERSION = 1;

export type SeedMode = "reference" | "demo";

export function seedMode(): SeedMode {
  return (process.env.LECLAUDE_SEED ?? "").trim().toLowerCase() === "demo" ? "demo" : "reference";
}

export type Seeder = (db: Database) => void | Promise<void>;

/** Reference data only: the template gallery and the system workflows (idempotent, stable ids). */
function seedReference(db: Database) {
  const existing = new Set(db.workflows.all().map((w) => w.id));
  const fresh = [...buildTemplates(), ...buildSystemTemplates()].filter((w) => !existing.has(w.id));
  if (fresh.length) db.workflows.putMany(fresh);
}

const REFERENCE_SEEDERS: { name: string; run: Seeder }[] = [{ name: "reference", run: seedReference }];

const DEMO_SEEDERS: { name: string; run: Seeder }[] = [
  { name: "core", run: seedCore },
  { name: "home", run: seedHome },
  { name: "ediscovery", run: seedEdiscovery },
  { name: "workflows", run: seedWorkflows },
  { name: "library", run: seedLibrary },
  { name: "office", run: seedOffice },
  { name: "search", run: seedSearch },
  { name: "intel", run: seedIntel },
  { name: "intel-analysis", run: seedIntelAnalysis },
];

let seeding = false;
let seededVersion: number | null = null;

function seedKey() {
  return seedMode() === "demo" ? "seed:version" : "seed:reference-version";
}

export function ensureSeeded(database: Database) {
  if (seededVersion === SEED_VERSION || seeding) return;
  const key = seedKey();
  const current = database.kv.get<number>(key);
  if (current === SEED_VERSION) { seededVersion = current; return; }
  seeding = true;
  try {
    const seeders = seedMode() === "demo" ? DEMO_SEEDERS : REFERENCE_SEEDERS;
    for (const s of seeders) {
      const r = s.run(database);
      if (r && typeof (r as Promise<void>).then === "function") {
        // Seeders are expected to be synchronous; async seeders are tolerated but not awaited.
        (r as Promise<void>).catch((e) => console.error(`[seed:${s.name}]`, e));
      }
    }
    database.kv.set(key, SEED_VERSION);
    seededVersion = SEED_VERSION;
    console.log(`[leclaude] seeded ${seedMode()} data (v${SEED_VERSION})`);
  } finally {
    seeding = false;
  }
}

/** Force a re-run of all seeders (used by `npm run seed`). */
export function reseed(database: Database) {
  seededVersion = null;
  database.kv.delete(seedKey());
  ensureSeeded(database);
}
