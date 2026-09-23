# LeClaude — engineering conventions

Internal legal AI platform (Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, OpenAI Responses API, SQLite via `node:sqlite`).

## Layout
- `src/app/**` routes and API handlers only (thin; delegate to `src/modules/**`).
- `src/modules/<module>/**` feature code: components (`"use client"` where needed), server services, seeds, agent tools.
- `src/lib/db` data layer: `db()` returns typed collections (`db().matters`, `db().edocs`, …) plus `db().collection<T>("name")` for module-private data. All reads are in-memory cached; writes are synchronous.
- `src/lib/ai` OpenAI runtime: `runAgent()` (streaming tool loop), `generateText()`, `generateJSON()`, `describeImage()`, `embedTexts()`, `hybridSearch()`/`indexDocuments()`; `src/lib/ai/toolkit` research tools (`researchToolset()`), `src/lib/ai/tools.ts` (`defineTool`).
- `src/components/ui` primitives (shadcn-style); `src/components/ai` chat/composer/markdown; `src/components/shell` app shell.
- `src/modules/office/shared` office agent protocol: `createOfficeAgentHandler()` (route factory), `OfficeAgentPanel` (UI), `useOfficeDoc()` (load/autosave/versions/comments), `EditProposal` types, docs API under `/api/office/docs`.

## Rules
- Server-only modules import `"server-only"`. Never import `@/lib/db` or `@/lib/ai/*` (except `config`, `sse`, `tools` types) from client components.
- API routes: `export const runtime = "nodejs"`; return `Response.json(...)`; use `jsonError()` for errors; stream with `sseResponse()`.
- Every AI feature goes through `runAgent`/`generateText`/`generateJSON` (OpenAI). Never hardcode model names; use `aiConfig()`. Handle `AIConfigError` by returning a 503-style error event/JSON so the UI can show "add your OpenAI key".
- Tools: `defineTool({ name, description, parameters (JSON schema), execute })`. Optional params are fine (converted to nullable for strict mode). Return compact JSON; truncate large text.
- Seeds: idempotent `putMany` with stable ids (see `src/lib/seed/ids.ts`). Realistic legal content, no lorem ipsum.
- UI: dense, professional, keyboard-friendly, dark-mode aware (tokens only, no hardcoded colors), `lucide-react` icons, `sonner` toasts, `cn()` for classes. Pages fill the shell: root element `h-full` with its own scroll regions.
- Next 15: route handler `params` is a Promise (`{ params }: { params: Promise<{ id: string }> }`); `searchParams` in pages is a Promise too.
- Do not run `npm install` (all dependencies are present) and do not run `next build` while other work is in flight; validate with `npx tsc --noEmit` and `npx eslint <your files>`.
- Tests: vitest (`npm test`), `server-only` is shimmed in tests; put tests in `tests/` or `*.test.ts`.
