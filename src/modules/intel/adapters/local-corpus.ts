import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { sha256 } from "@/lib/integrity/hash";
import { intelConfig } from "../config";
import { extensionOf, extractIntelText, SUPPORTED_EXTENSIONS } from "../extract";
import { intelDocuments } from "../store";
import { defineAdapter } from "./types";

const schema = z.object({
  /** Folders to walk; falls back to LECLAUDE_CORPUS_DIRS when empty. */
  dirs: z.array(z.string().min(1)).default([]),
  recursive: z.boolean().default(true),
  maxFileMb: z.number().min(0.1).max(200).default(25),
  maxFiles: z.number().int().min(1).max(20_000).default(500),
  extensions: z.array(z.string()).default([...SUPPORTED_EXTENSIONS]),
  skipHidden: z.boolean().default(true),
  /** Folder name (case-insensitive) → matter id. Matter slugs and short names also match automatically. */
  matterMap: z.record(z.string(), z.string()).default({}),
  maxTextChars: z.number().int().min(2000).max(600_000).default(400_000),
});

export type LocalCorpusConfig = z.infer<typeof schema>;

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "__pycache__", ".DS_Store", "$RECYCLE.BIN", "System Volume Information"]);

function* walk(dir: string, recursive: boolean, skipHidden: boolean, depth = 0): Generator<string> {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (skipHidden && e.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (recursive && depth < 12) yield* walk(p, recursive, skipHidden, depth + 1); }
    else if (e.isFile()) yield p;
  }
}

/** The firm's own folders: incremental by mtime + content hash, mapped to matters by folder name. */
export const localCorpusAdapter = defineAdapter<LocalCorpusConfig>({
  id: "local-corpus",
  name: "Local document folders",
  description: "Indexes documents in configured folders (PDF, Word, Excel, text, Markdown, HTML, CSV, JSON), incrementally, mapping folders to matters.",
  kinds: ["local_file"],
  family: "local",
  requires: [],
  configSchema: schema,
  defaults: schema.parse({}),
  async run(ctx) {
    const cfg = ctx.config;
    const dirs = Array.from(new Set([...(cfg.dirs.length ? cfg.dirs : intelConfig().corpusDirs), ...(ctx.scope.targets ?? []).filter((t) => t.startsWith("/") || /^[A-Za-z]:\\/.test(t))]));
    if (!dirs.length) {
      ctx.result.errors.push({ code: "not_configured", message: "No folders configured (set LECLAUDE_CORPUS_DIRS or the source's dirs).", retryable: false, fatal: false, at: ctx.now.toISOString() });
      ctx.note("Not configured: set LECLAUDE_CORPUS_DIRS or add folders to this source.");
      return;
    }
    const exts = new Set(cfg.extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const matterKeys = new Map<string, string>();
    for (const [k, v] of Object.entries(cfg.matterMap)) matterKeys.set(norm(k), v);
    for (const m of ctx.matters) { matterKeys.set(norm(m.slug), m.id); matterKeys.set(norm(m.shortName), m.id); matterKeys.set(norm(m.id), m.id); }
    const maxBytes = cfg.maxFileMb * 1024 * 1024;
    let seen = 0;
    for (const dir of dirs) {
      const root = path.resolve(dir);
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) { ctx.fail(new Error(`Folder not found: ${root}`), { label: root }); continue; }
      for (const file of walk(root, cfg.recursive, cfg.skipHidden)) {
        if (seen >= cfg.maxFiles) { ctx.note(`File cap (${cfg.maxFiles}) reached; remaining files are picked up on the next run.`); break; }
        if (ctx.budgetLeft() <= 0) break;
        const ext = extensionOf(file);
        if (!exts.has(ext)) continue;
        seen++;
        let stat: fs.Stats;
        try { stat = fs.statSync(file); } catch (e) { ctx.fail(e, { label: file }); continue; }
        const externalId = `file:${file}`;
        const existing = ctx.existing(externalId);
        const meta = (existing?.meta ?? {}) as { mtimeMs?: number; size?: number; fileHash?: string };
        if (existing && meta.mtimeMs === stat.mtimeMs && meta.size === stat.size && existing.chunkCount > 0) { ctx.result.skipped++; continue; }
        if (stat.size > maxBytes) { ctx.note(`Skipped ${path.basename(file)} (${(stat.size / 1048576).toFixed(1)} MB exceeds ${cfg.maxFileMb} MB).`); ctx.result.skipped++; continue; }
        let bytes: Uint8Array;
        try { bytes = fs.readFileSync(file); } catch (e) { ctx.fail(e, { label: file }); continue; }
        const fileHash = sha256(bytes);
        if (existing && meta.fileHash === fileHash && existing.chunkCount > 0) {
          // Touched but identical: refresh the stat cache only.
          intelDocuments().put({ ...existing, meta: { ...existing.meta, mtimeMs: stat.mtimeMs, size: stat.size }, fetchedAt: ctx.now.toISOString() });
          ctx.result.skipped++;
          continue;
        }
        const rel = path.relative(root, file);
        const segments = rel.split(path.sep).slice(0, -1).map(norm);
        const matterIds = Array.from(new Set(segments.map((s) => matterKeys.get(s)).filter((x): x is string => Boolean(x))));
        const extracted = await extractIntelText(bytes, path.basename(file), "");
        const text = extracted.text.slice(0, cfg.maxTextChars);
        await ctx.attempt(`ingest ${rel}`, () => ctx.ingest({
          kind: "local_file",
          title: path.basename(file),
          summary: extracted.title,
          dates: { modified: stat.mtime.toISOString().slice(0, 10), event: stat.mtime.toISOString().slice(0, 10) },
          url: `file://${file}`,
          externalId,
          matterIds,
          text: text || `(no text could be extracted from ${path.basename(file)}${extracted.warning ? `: ${extracted.warning}` : ""})`,
          tags: ["local", ext],
          confidence: text ? (extracted.method === "pdfjs" ? 0.8 : 0.9) : 0.3,
          flags: text ? [] : [{ kind: "parse_error", note: extracted.warning ?? "No text extracted", at: ctx.now.toISOString(), by: "adapter:local-corpus" }],
          meta: { path: file, dir: root, relativePath: rel, size: stat.size, mtimeMs: stat.mtimeMs, fileHash, ext, method: extracted.method, pages: extracted.pages, truncated: extracted.truncated || text.length < extracted.text.length, warning: extracted.warning },
        }));
      }
    }
  },
});
