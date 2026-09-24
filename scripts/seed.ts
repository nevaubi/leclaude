import { db } from "../src/lib/db";
import { reseed } from "../src/lib/seed";
import { rebuildIndex } from "../src/modules/library/service";

async function main() {
  reseed(db());
  console.log("Seed complete.");
  if (process.env.OPENAI_API_KEY) {
    console.log("Building semantic index (embeddings)…");
    const r = await rebuildIndex({ embed: true, includeOffice: true });
    console.log("Index:", JSON.stringify(r));
  } else {
    console.log("OPENAI_API_KEY not set: keyword-only index built; run `npm run seed` again with a key for semantic search.");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
