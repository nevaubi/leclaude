import { db } from "../src/lib/db";
import { reseed } from "../src/lib/seed";

reseed(db());
console.log("Seed complete.");
