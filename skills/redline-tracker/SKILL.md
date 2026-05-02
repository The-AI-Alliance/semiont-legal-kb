---
name: redline-tracker
description: Track contract evolution. Given a path to a new contract version (markdown) and the resourceId of the prior version, ingest the new version, link it to the prior via a "supersedes" annotation, run a section-aware diff, and synthesize one VersionDelta resource per change.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user track a contract through revision rounds. Each redline becomes a Resource with structured links to its predecessor and a synthesized **VersionDelta resource** per change.

## What it does

Given the path to a new contract version (markdown) and the resourceId of the prior version:

1. `yield.resource` the new version (entity types `[Contract, Amendment]`).
2. Create a `linking`-motivation annotation on the new version anchored to the document title with a `tagging` body of `supersedes` and a `SpecificResource` body pointing to the prior version — encoding the version chain in the KB.
3. Compare the two markdown bodies via [`src/diff.ts`'s `diffContracts`](../../src/diff.ts), which returns a structured list of `SectionChange` records (added / removed / modified, with anchor + heading + before/after excerpts).
4. For each change: `yield.resource` a small **VersionDelta resource** describing one section change, with entity types `[VersionDelta]` and metadata embedding the prior + new resource IDs and the change kind. Body markdown contains the heading, the before excerpt (if any), and the after excerpt (if any).

The VersionDelta resources together form the contract evolution graph: queryable as "show me everything that changed between two versions" or "what's the full lineage of section 4.2?".

## SDK verbs

- `browse.resourceContent` (fetch prior version body)
- `yield.resource` (new version + per-change deltas)
- `mark.annotation` (linking with `supersedes` tag, plus SpecificResource pointing to prior)

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `<priorVersionResourceId>` | CLI arg | required | The resourceId of the prior version |
| `<newVersionPath>` | CLI arg | required | Filesystem path (relative to repo root) to the new version's markdown file |
| `NEW_VERSION_NAME` | env var | filename-derived | Override the new version's display name |

## Tier-3 interactive checkpoint

After diff: prints detected change count + list of headings, asks `confirm` before yielding deltas.

## Run it

**Prerequisite: the prior version is already a resource in the KB** (typically because it was ingested by skill 1). The new version's markdown file is on disk at the path you pass.

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/redline-tracker/script.ts <priorVersionResourceId> <newVersionPath>'
```

Add `-e SEMIONT_INTERACTIVE=1 -it` for the confirm prompt.

## Guidance for the AI assistant

- **Section detection is heuristic.** The diff splitter looks for markdown headings (`## 4.2 …`, `## Section 4.2 …`, `## Exhibit C …`, etc.). If neither version has detectable headings, the diff falls back to a single whole-document `modified` change.
- **Provenance closes the loop.** The plan calls for VersionDelta resources to bind to the proposing email / letter / memo where applicable. v1 records the change itself; binding deltas to their proposing correspondence is a follow-up the user can do via `mark.annotation` with a `linking` motivation pointing from the delta into the email — or as a future `attribute-redlines` skill that walks correspondence and binds it automatically.
- **Re-running on the same versions creates duplicate VersionDelta resources.** No deduplication by version pair. Restart the backend or hand-delete prior deltas before re-running.
- **PDF redlines are out of scope.** The skill operates on markdown — for a PDF redline, run a PDF-to-markdown conversion first (out-of-scope helper; future enhancement).
