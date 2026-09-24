# LeClaude — internal legal AI platform

LeClaude is a self-hosted, AI-native operating platform for a law firm. It combines:

| Surface | What it does |
| --- | --- |
| **Home** | Daily brief, firm news with relevance to open matters, team updates, calendar with deadline calculator, tasks (kanban), matter overview, firm assistant. |
| **Search** | Agentic legal research across case law (CourtListener), statutes and the U.S. Code (GovInfo), regulations (eCFR), Federal Register, federal dockets (RECAP), the web (OpenAI web search), the firm library and matter documents. Streams a cited synthesis alongside structured results, with a reader, citation checker and one-click research memos. |
| **E-Discovery** | Everlaw/Relativity-style review: faceted review grid with Bates ranges and boolean/semantic search, document viewer with AI coding suggestions, batch responsiveness prediction, issue codes, privilege log generation, production export; deposition transcripts with objection tracking and AI digests; cross-analysis and contradiction finding; chronology/timeline extraction; people knowledge graph; conflicts. |
| **Workflows** | A visual, Zapier-for-law builder with AI/data/logic/action nodes, a DAG engine with approvals, streaming runs, scheduling and a template gallery of legal playbooks. |
| **Office** | Browser-based Word, Excel, PowerPoint and PDF editors, each with a drafting agent (Draft / Review / Ask) that reads the whole document, proposes previewable edits, applies them as tracked changes, researches with citations, transcribes screenshots, generates images and diagrams, and keeps version history and comments. |
| **Library** | Shared folders per matter, templates, clause bank with variables, knowledge notes, hybrid semantic search, uploads/imports, "ask the library". |

Everything AI-related runs on the **OpenAI Responses API** through one runtime (`src/lib/ai/agent.ts`): streaming tool loops, structured outputs, embeddings, vision and image generation. Bring your own key; no other AI provider is used.

## Quick start

```bash
# Node.js 22.13+ is required (uses the built-in node:sqlite; no native modules)
cp .env.example .env.local      # add OPENAI_API_KEY
npm install
npm run dev                     # http://localhost:3000
```

The first request creates `./data/leclaude.db` and seeds a realistic demo firm (Seeger Weiss LLP) with five matters, custodial documents, depositions, chronologies, workflows, office documents and a library. Reset at any time with `npm run db:reset`.

Other scripts: `npm run typecheck`, `npm run lint`, `npm test` (vitest), `npm run build && npm start`, `npm run seed` (re-run all seeders).

## Configuration

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required for every AI feature. Without it, the UI still works (search retrieval, editors, review, workflows without AI steps) and shows a clear "OpenAI key required" state. |
| `OPENAI_MODEL` | Primary reasoning model for agents (default `gpt-5.4`). Any Responses-API model id works. |
| `OPENAI_FAST_MODEL` | Fast model for classification, summaries and background indexing (default `gpt-5.4-mini`). |
| `OPENAI_EMBEDDING_MODEL` | Embeddings for semantic search (default `text-embedding-3-large`). |
| `OPENAI_IMAGE_MODEL` | Image generation for the office tools (default `gpt-image-1.5`). |
| `OPENAI_REASONING_EFFORT` | `none`…`xhigh` (default `medium`). |
| `OPENAI_BASE_URL` | Optional proxy / Azure-compatible base URL. |
| `COURTLISTENER_API_TOKEN` | Optional; raises CourtListener rate limits. |
| `GOVINFO_API_KEY` | Optional (defaults to `DEMO_KEY`). |
| `LECLAUDE_DATA_DIR` | Where the SQLite database and uploads live (default `./data`). |
| `NEXT_PUBLIC_FIRM_NAME`, `NEXT_PUBLIC_APP_NAME` | Branding in the shell. |

## Architecture

```
src/
  app/                 routes + API handlers (thin)
  components/ui        shadcn-style primitives (Radix)      components/ai  chat, composer, markdown
  components/shell     sidebar, top bar, command palette (⌘K), theme
  lib/db               node:sqlite: JSON collections (cached), kv, vectors, blobs
  lib/ai               OpenAI runtime: runAgent (streaming tool loop), generateText/JSON, embeddings,
                       hybrid vector store (cosine + BM25), sse helpers, prompts, images
  lib/ai/toolkit       research tools: web_search + fetch_url, CourtListener (opinions, dockets,
                       citation lookup), eCFR, Federal Register, GovInfo, library + e-discovery search
  lib/seed             demo data registry (stable ids in ids.ts)
  modules/<feature>    feature code: components, services, seeds, agent tools
  modules/office/shared office agent protocol: route factory, proposal types, agent panel,
                       document versions/comments API, markdown→document converter
```

### The office agent protocol

Each editor sends a **snapshot** of its document model (paragraph ids, cells, slides, pages) to its agent route. The route (built with `createOfficeAgentHandler`) runs the OpenAI agent loop with two tool families:

* **read tools** that inspect the snapshot (outline, paragraphs, ranges, find/grep, selection, stats), and
* **edit tools** that emit **proposals** (`EditProposal`) and also mutate the server-side snapshot so later tool calls see the updated state.

Proposals stream to the client as SSE events; the `OfficeAgentPanel` shows them as a checklist (Apply all / Apply selected / Discard, or auto-apply) and the editor applies them — in Word as word-level tracked changes with accept/reject, in Excel as undoable model mutations, and so on. Research is a toggle: when on, the agent also gets web search, case law, statutes, regulations, dockets and the firm library; when off it still has matter context and internal search. Every applied batch becomes a named version ("Agent edit: …") so work can be restored.

### Data

SQLite through Node's built-in `node:sqlite` (no native build). Records are JSON documents in typed collections with an in-memory cache, so list/filter operations are sub-millisecond even for tens of thousands of documents. Embeddings live in a `vectors` table and are searched with cosine similarity fused with BM25 (MiniSearch); without an API key the index works keyword-only.

### Research providers

CourtListener (v4 search, opinions, dockets, citation lookup), eCFR search/versioner, Federal Register API and GovInfo are public endpoints; OpenAI's built-in web search is used for the open web. All tool calls are logged in the UI with arguments and results so lawyers can see what the agent actually read.

## Development notes

* `npm test` uses vitest with `server-only` shimmed; tests live under `tests/`.
* Route handlers use the Node runtime; `params`/`searchParams` are promises (Next 15).
* HyperFormula (spreadsheet formulas) is used under its GPLv3 license for internal deployment; replace with a commercial license if you distribute the software.
* The sandbox this project was built in had no outbound network, so live OpenAI and research-provider calls are exercised at runtime rather than in tests; the integrations follow the SDK's TypeScript definitions exactly.
