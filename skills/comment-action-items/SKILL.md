---
name: comment-action-items
description: Surface action items, deadlines, and required follow-ups across the markdown corpus. Each commenting annotation captures a pending piece of work in the matter.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user surface the *pending work* in a legal matter — the items that downstream tooling (a Kanban board, a notification bot, or skill 10's checklist synthesis) drives against.

## What it does

For each markdown corpus resource (or one specific resource), runs `mark.assist({ motivation: 'commenting', instructions: ... })`. Each commenting annotation captures one of: an action item, a deadline, a required follow-up, a verification request, an outstanding signature, or any "we need to confirm / verify / decide" sentence.

PDFs are skipped.

## SDK verbs

- `browse.resources` — find markdown corpus targets
- `mark.assist({ motivation: 'commenting', instructions: ... })`

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `<resourceId>` | CLI arg (optional) | all markdown corpus resources | Scope to one |
| `COMMENT_INSTRUCTIONS` | env var | the standard "action items + deadlines + follow-ups" directive | Replace |

## Tier-3 interactive checkpoint

Before run: prints target count + first line of the instruction text, asks `confirm`.

## Run it

**Prerequisite: `ingest-corpus` has been run.**

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/comment-action-items/script.ts'
```

Add `-e SEMIONT_INTERACTIVE=1 -it` for the confirm prompt.

## Guidance for the AI assistant

- **Action items feed `build-due-diligence-checklist` (skill 10).** That skill aggregates these commenting annotations into a single Checklist resource — a matter's living front page.
- **Comments are the where, action items are the what.** A commenting annotation includes the source paragraph, an inferred deadline (where one is stated), and an inferred owner (where named). Skill 10 surfaces those inferences in the checklist.
- **Re-running adds annotations cumulatively.** No deduplication.
