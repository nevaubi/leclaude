import "server-only";
import type { Database } from "@/lib/db";
import { seedWord } from "@/modules/office/word/seed";
import { seedSheet } from "@/modules/office/sheet/seed";
import { seedSlides } from "@/modules/office/slides/seed";
import { seedPdf } from "@/modules/office/pdf/seed";

/** Office suite seed: delegates to each editor's seed. */
export function seedOffice(db: Database) {
  seedWord(db);
  seedSheet(db);
  seedSlides(db);
  seedPdf(db);
}
