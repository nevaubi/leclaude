# Legal evals

Held-out adversarial cases for the constitution's hard invariants (CLAUDE.md §22 authorization, §23 evidence
contract, §24 high-risk fields, §43–44 required adversarial tests). Every case runs against the real code paths
(`src/lib/auth/**`, `src/lib/evidence/**`, the seeded record) — never against a mock of them.

## Running

```bash
npx tsx evals/run.ts                 # every case; exits 1 on any failure, never on skips
npx tsx evals/run.ts wrong-bates     # one or more case ids
npx tsx evals/run.ts --json          # machine-readable results
LECLAUDE_EVALS=1 npx vitest run tests/evals-cases.test.ts   # same harness under vitest
```

Deterministic cases pass offline. Cases whose executor needs a model (claim verification end to end, a
generated answer graded by rubric) are **skipped** with `needs a configured model provider` unless
`OPENAI_API_KEY` is set; under vitest they additionally require `LECLAUDE_EVALS=1` so the default test run stays
offline and fast. The runner uses a scratch database (`LECLAUDE_EVALS_DATA_DIR`, default under the OS temp dir);
it never touches `data/`.

## Grading

- **Code grading** wherever the behavior is deterministic: exact/structural matches on `Citation.state`,
  `PolicyDecision.allow`, `TrustState`, `VerificationVerdict.status`, thrown error classes.
- **Model grading** only where wording must be judged (a generated no-answer). The grader uses a fixed rubric,
  asks for reasoning first and then exactly one verdict tag: `<result>correct</result>` or
  `<result>incorrect</result>`.

Cases are graded to **fail on the forbidden behaviors** (an unresolved Bates bound to another document, a
cross-matter binding, a quote that is not in its source counted as support, a stale verification kept after an
edit, privilege inferred from a cc line), not merely to pass on the happy path.

## Case files

`evals/cases/<id>.json`:

| field | meaning |
|---|---|
| `id`, `category`, `title` | identity |
| `constitution` | the rule the case enforces |
| `input` | what the executor feeds the code path |
| `expected` | expected behavior, in words |
| `passCriteria` | the checks the executor performs (code) or the rubric (model) |
| `grading` | `code` or `model` |
| `requiresModel` | whether a model provider is needed for any part |

Executors live in `evals/harness.ts`, keyed by case id. A case may combine a deterministic part (always run) with
a model part (skipped offline); the case passes only when every executed check passes.

## Cases

| id | category | model |
|---|---|---|
| late-qualification | deposition | partial |
| wrong-bates | citations | no |
| cross-matter-name-collision | authorization | no |
| citation-exists-but-does-not-support | verification | partial |
| no-answer-in-record | verification | partial (rubric-graded) |
| stale-office-edit | trust | no |
| privilege-cc | privilege | no |
| adverse-authority | research | partial |
| high-risk-deadline | verification | no |
| nonexistent-document | citations | no |
| oversized-artifact | robustness | no |
| hostile-content | security | no |
| ambiguous-bates | citations | no |
