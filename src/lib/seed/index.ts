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

/**
 * Seed registry. Bump SEED_VERSION when seed content changes materially; the
 * seeders run in order and must be idempotent (use putMany with stable ids).
 */
export const SEED_VERSION = 1;

export type Seeder = (db: Database) => void | Promise<void>;

const SEEDERS: { name: string; run: Seeder }[] = [
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

export function ensureSeeded(database: Database) {
  if (seededVersion === SEED_VERSION || seeding) return;
  const current = database.kv.get<number>("seed:version");
  if (current === SEED_VERSION) { seededVersion = current; return; }
  seeding = true;
  try {
    for (const s of SEEDERS) {
      const r = s.run(database);
      if (r && typeof (r as Promise<void>).then === "function") {
        // Seeders are expected to be synchronous; async seeders are tolerated but not awaited.
        (r as Promise<void>).catch((e) => console.error(`[seed:${s.name}]`, e));
      }
    }
    database.kv.set("seed:version", SEED_VERSION);
    seededVersion = SEED_VERSION;
    console.log(`[leclaude] seeded demo data (v${SEED_VERSION})`);
  } finally {
    seeding = false;
  }
}

/** Force a re-run of all seeders (used by `npm run seed`). */
export function reseed(database: Database) {
  seededVersion = null;
  database.kv.delete("seed:version");
  ensureSeeded(database);
}
