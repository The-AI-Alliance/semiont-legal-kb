---
name: build-party-graph
description: Promote Person and Organization mentions to canonical Party resources. Relationships between parties (counterparty, lessor/lessee, principal/agent, employer/employee, etc.) are the assistant's to decide and record.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user build the **Party graph** — the who's-who of a legal matter — out of the entity annotations from skill 2.

This is a tier-2 skill. It composes `gather.annotation` + `match.search` + `yield.delegate` + `bind.body`. Foundational for skill 6 (`resolve-descriptive-references`), which needs Party resources to bind descriptive references against.

## What it does

**Promote Person/Organization mentions to Party resources.**

1. `browse.annotations` across the markdown corpus; filter to `linking`-motivation annotations whose body has `Person` or `Organization` tagging values (these are skill 2's output).
2. Cluster annotations by canonical text (case-insensitive surface form).
3. For each cluster:
   - `gather.annotation` for context.
   - `match.search` for an existing Party resource.
   - If a candidate scores ≥ `MATCH_THRESHOLD`: `bind.body` the annotation to the existing resource.
   - Otherwise: `yield.delegate` to synthesize a new Party resource (entity types `[Party, Person]` or `[Party, Organization]`), then `bind.body`.

**Relationships between parties.**

No job extracts relationships, and a linking job takes no instructions. Deciding that a passage relates two parties is yours, reading the passage as the assistant, or the user's. The method, and the script that records what you decided, are the [`semiont-relate`](https://github.com/The-AI-Alliance/semiont/tree/main/docs/builder/skills/semiont-relate) skill's: a relationship is a Relationship resource the establishing passage is bound to. This corpus's relationship types: `counterparty`, `lessor-lessee`, `principal-agent`, `employer-employee`, `parent-subsidiary`, `attorney-client`, `fiduciary-beneficiary`, `role-at-org`, `represented-by`. Record only what the document's language supports.

## SDK verbs

- `browse.resources`, `browse.annotations`, `gather.annotation`, `match.search`, `yield.delegate`, `bind.body`

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `MATCH_THRESHOLD` | env var | 30 | Cluster-merge / match threshold |

## Tier-3 interactive checkpoint

Before promoting: prints cluster summary, asks `confirm`. Per cluster (interactive only): per-synthesis confirm with the candidate text shown.

## Run it

**Prerequisite: `mark-named-entities` (skill 2) has been run.**

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  node:24-alpine \
  sh -c 'npm ci --no-audit --no-fund && npx tsx skills/build-party-graph/script.ts'
```

The script prints an address: open it in a browser and approve the sign-in. [Signing in](https://github.com/The-AI-Alliance/semiont/blob/main/docs/builder/SIGN-IN.md) has the other ways a script can sign in.

Add `-e SEMIONT_INTERACTIVE=1 -it` for the per-cluster confirms.

## Guidance for the AI assistant

- **Foundational for descriptive-reference resolution.** Skill 6 (`resolve-descriptive-references`) needs Party resources to bind against. Run this skill before skill 6.
- **Cluster-merge is exact-text.** Two surface forms ("Acme Corp" vs. "Acme Corporation") that should refer to one Party still cluster as separate entries unless the match-search step pulls them together. The interactive checkpoint surfaces the candidate clusters, letting the user steer merges manually for the first run. After the first run synthesizes Party resources, subsequent re-runs match each cluster against the existing resources via `match.search` — meaning the *system gets smarter as it runs*. If you spot near-duplicate Party resources after a run, hand-merging them via the Semiont browser preserves the binding annotations.
- **Re-running is idempotent for already-bound annotations.** Annotations with an existing SpecificResource body are skipped. New annotations from later `mark-named-entities` runs get processed.
