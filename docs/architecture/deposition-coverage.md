# Deposition coverage and counterevidence (design for wave 2)

Constitution §28: a deposition digest is never labeled comprehensive when only an arbitrary
transcript prefix was analyzed. This design is implemented by the e-discovery analysis wave
once the phase-3 e-discovery build lands; it is written against the committed evidence and
trust contracts (`src/lib/evidence/*`).

## Pipeline

```
transcript (page/line map)
→ segment            fixed windows of N pages with a one-page overlap; every segment records
                     its page range and a content hash
→ analyze segments   generateJSON per segment (strict schema): admissions, qualifications,
                     corrections/errata, objections and rulings, exhibits, topics; every item
                     carries page:line and a verbatim quote
→ coverage map       pages analyzed / pages total, per-segment status (analyzed | failed |
                     skipped | budget), the model and prompt version used
→ counterevidence    for each admission: lexical + semantic search across ALL segments for
                     qualifications, negations, corrections, errata and later testimony on the
                     same topic; hits are attached to the admission with page:line and quote
→ synthesize         the digest is written from the segment outputs and the counterevidence
                     links, not from a single prefix read
→ verify             every quote is checked against the transcript text by code (literal
                     match after whitespace normalization); the verdict binds to the digest hash
```

## Rules

- **Comprehensive only at 100% coverage.** The digest header shows "Analyzed 212 of 212 pages"
  or "Analyzed 120 of 212 pages — partial" with the failed/skipped ranges listed; the
  `comprehensive` flag is set only when every page is in an analyzed segment.
- **Admissions are never displayed without their counterevidence scan.** An admission whose
  scan found a later qualification shows both, in page order, with the trust state
  `partially_supported` until a reviewer decides.
- **Quotes must exist.** A quote that does not literally appear at the cited page:line demotes
  the item to `unsupported` and surfaces it in the review queue; nothing is silently dropped.
- **Witness identity is matter-scoped.** Witness and person resolution uses the matter's
  people set; ambiguity produces `requires_review` (no closest-name binding).
- **Budget exhaustion is a state, not a failure.** When the token or time budget ends before
  all segments are analyzed, the run ends `budget_exhausted` with the coverage map intact and a
  resumable cursor; the UI offers "Continue analysis".
- **Errata are first-class.** An errata sheet is parsed as corrections and linked to the lines
  it changes; the digest shows the corrected testimony and the original.

## Data

```
DepositionAnalysis {
  depositionId, matterId, transcriptHash, digestHash, promptVersion, model,
  coverage: { pagesTotal, pagesAnalyzed, segments: SegmentStatus[] , comprehensive: boolean },
  admissions: Admission[]    // { id, quote, page, line, lineEnd, topic, counterevidence: Link[], trust }
  qualifications: Item[], corrections: Item[], objections: Item[], exhibits: Item[], topics: Topic[],
  verification: VerificationVerdict (bound to digestHash),
  terminal: RunTerminalState, stopReason
}
```

## Adversarial case (constitution §44, "late qualification")

Fixture: a 240-page transcript where the witness admits at 20:4–20:11 that the product
warning was "never updated after 2015" and at 220:14–221:2 clarifies that "the label was
revised in 2018 after the FDA letter; I misspoke earlier". Expected: both items present, the
admission linked to the qualification, digest trust state `partially_supported`, and the
`comprehensive` flag true only when all 240 pages were analyzed. The case is code-graded
(presence, page:line accuracy, link, flag) and lives in `evals/cases/late-qualification.json`.

## UI

- Header: coverage bar and count, model label, trust badge, "Continue analysis" when partial.
- Admissions list: quote, page:line, topic, counterevidence count; expanding shows the linked
  later testimony with its own page:line.
- Every item has a source link that opens the transcript at the cited line.
- States: empty (no transcript), loading, progressive (segments streaming in), partial,
  failed (with the failed ranges), cancelled, permission denied.
