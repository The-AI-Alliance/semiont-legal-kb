---
name: build-section-graph
description: Decompose a structured legal document into per-section LegalSection resources, then walk every section reference across the corpus and bind it to the canonical section.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user turn a structured legal document (a contract, policy, or other document with numbered sections) into a navigable section graph. After this skill runs, every cross-document mention of "Section 4.2" or "Exhibit C" is a clickable link to the canonical section.

## What it does

Given the resource id of a structured document (typically a `Contract`):

1. Fetches the document body via `gather.annotation` (or by directly reading the resource's representation).
2. Splits the body into sections via [`src/sections.ts`'s `splitMarkdownSections`](../../src/sections.ts) — markdown headings with anchors like `4.2`, `Exhibit C`, `Article III`, etc.
3. For each section: `yield.resource` a new resource (entity types `[LegalSection]`, `format: text/markdown`, body = the section's content).
4. Walks every `linking`-motivation annotation across the corpus tagged with `LegalSection` (skill 2's output, identifying mentions like "Section 4.2"):
   - `gather.annotation` for context
   - `match.search` against the new LegalSection resources just created
   - `bind.body` to the matching section if a candidate scores ≥ `MATCH_THRESHOLD`

If the document has no markdown headings, the skill exits gracefully — no sections to extract, and the existing LegalSection annotations are still queryable as plain text references.

## SDK verbs

- `browse.resources`, `gather.resource` (or the SDK's resource-content fetch), `yield.resource` (per section), `browse.annotations`, `gather.annotation`, `match.search`, `bind.body`

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `<contractResourceId>` | CLI arg | required | Which contract / structured document to decompose |
| `MATCH_THRESHOLD` | env var | 30 | Cross-document section-reference match threshold |

## Tier-3 interactive checkpoint

Before yielding sections: prints detected section count + first few headings, asks `confirm`. (Section detection is heuristic; surfacing the headings before bulk-yielding lets the user catch obvious mis-segmentation.)

## Run it

**Prerequisites: `ingest-corpus` and `mark-named-entities` have been run.** You'll need the resource id of the structured document — find it via `semiont.browse.resources({ search: '<title>' })` or from skill 1's output.

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/build-section-graph/script.ts <contractResourceId>'
```

Add `-e SEMIONT_INTERACTIVE=1 -it` for the confirm prompt.

## Guidance for the AI assistant

- **Section parsing is heuristic.** The splitter looks for markdown headings with patterns like `## 4.2 …`, `## Section 4.2 …`, `## Exhibit C …`. Documents that don't follow markdown-heading conventions (e.g., plain-text contracts, OCR'd PDFs) won't decompose cleanly. The interactive checkpoint surfaces what was detected.
- **Cross-document binding is also heuristic.** `match.search` finds candidate sections by similarity; the threshold filters out weak matches. A "Section 4.2" mention in an email gets bound to the `LegalSection` resource for `4.2` *of the source contract* if and only if the contract was decomposed first.
- **Multi-contract corpora** need this skill run once per structured document. After all contracts have been decomposed, re-run skill 2 (or rely on its prior output) to ensure cross-contract section references can resolve to the right contract's sections.
- **Re-running on the same contract creates duplicate LegalSection resources.** Delete the prior set via the Semiont browser before re-running.
