#!/usr/bin/env node
/**
 * Copies the pdf.js worker to public/vendor so it can be served statically
 * (alternative to the /api/office/pdf/worker route). Usage:
 *   node src/modules/office/pdf/scripts/copy-worker.mjs
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
const dest = path.resolve(process.cwd(), "public/vendor/pdf.worker.min.mjs");
await mkdir(path.dirname(dest), { recursive: true });
await copyFile(src, dest);
console.log(`Copied ${src} → ${dest}`);
