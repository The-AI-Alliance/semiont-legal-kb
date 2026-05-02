---
name: build-due-diligence-checklist
description: Aggregate every commenting annotation from skill 5 (action items, deadlines, follow-ups) into a single Checklist resource — a matter's living front page.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user build a single **Checklist resource** that becomes the matter's *living front page*. Each row of the checklist is a pending item with provenance back to the source paragraph it came from.

## What it does

1. `browse.annotations` across the markdown corpus; collect every `commenting`-motivation annotation produced by skill 5 (`comment-action-items`).
2. For each: `gather.annotation` to fetch surrounding context (so the checklist row carries the source quote).
3. Compose a markdown body: one section per item, with the source quote, the source resource link, and (where extractable from the annotation body or surrounding text) the responsible party and the deadline.
4. `yield.resource` the assembled markdown as a Checklist resource (`entity types: ['Checklist', 'Aggregate']`).

The checklist is a navigation artifact, not a static report — re-run nightly as the corpus grows and the prior checklist is superseded by the new one. (To compare, list `entityTypes=Checklist` resources by creation timestamp.)

## SDK verbs

- `browse.resources`, `browse.annotations`, `gather.annotation`, `yield.resource`

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `CHECKLIST_NAME` | env var | `Due-diligence checklist` | Custom name for the synthesized Checklist resource |
| `INCLUDE_GATHER` | env var | `1` | Set to `0` to skip the per-item gather.annotation calls (cheaper, but checklist rows lose the surrounding-context excerpt) |

## Tier-3 interactive checkpoint

Before yield: prints aggregated row count + checklist name, asks `confirm`.

## Run it

**Prerequisite: `comment-action-items` (skill 5) has been run.**

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/build-due-diligence-checklist/script.ts'
```

Add `-e SEMIONT_INTERACTIVE=1 -it` for the confirm prompt.

## Guidance for the AI assistant

- **The checklist is queryable.** Once synthesized as a resource, the checklist participates in the SDK like any other resource — `browse.resources({ entityType: 'Checklist' })` lists prior runs; `mark.assist` can annotate items as completed; `bind.body` can link items to their resolution.
- **Provenance is bidirectional.** Each row carries a markdown link to its source resource. The source annotation, in turn, exists in the KB independently (a comment-motivation annotation pointing at the paragraph) — so "what's pending in this matter?" can be queried from either end.
- **Re-running is cheap if you skip `INCLUDE_GATHER`.** Without gather, the rows have no excerpt — but the link back to the source paragraph still works, so a click-through gets the user there.
