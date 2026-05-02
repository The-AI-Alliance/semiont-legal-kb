---
name: build-party-graph
description: Promote Person and Organization mentions to canonical Party resources, then extract inter-party relationships (counterparty, lessor/lessee, principal/agent, employer/employee, etc.) and tag them as binding annotations.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user build the **Party graph** — the who's-who of a legal matter — out of the entity annotations from skill 2.

This is a tier-2 skill. It composes `gather.annotation` + `match.search` + `yield.fromAnnotation` + `bind.body`, then runs a final `mark.assist` pass for relationship-extraction. Foundational for skill 6 (`resolve-descriptive-references`), which needs Party resources to bind descriptive references against.

## What it does

**Pass 1 — promote Person/Organization mentions to Party resources.**

1. `browse.annotations` across the markdown corpus; filter to `linking`-motivation annotations whose body has `Person` or `Organization` tagging values (these are skill 2's output).
2. Cluster annotations by canonical text (case-insensitive surface form).
3. For each cluster:
   - `gather.annotation` for context.
   - `match.search` for an existing Party resource.
   - If a candidate scores ≥ `MATCH_THRESHOLD`: `bind.body` the annotation to the existing resource.
   - Otherwise: `yield.fromAnnotation` to synthesize a new Party resource (entity types `[Party, Person]` or `[Party, Organization]`), then `bind.body`.

**Pass 2 — extract inter-party relationships.**

Runs `mark.assist({ motivation: 'linking', instructions: ... })` over each markdown corpus resource with an instruction set that targets relationship triples between named parties — counterparty (under a contract), lessor/lessee, principal/agent, employer/employee, parent/subsidiary, attorney/client, fiduciary/beneficiary, and any explicit role-at-organization pattern. Each detected relationship becomes an annotation with the relationship label encoded as a tagging body.

## SDK verbs

- Pass 1: `browse.resources`, `browse.annotations`, `gather.annotation`, `match.search`, `yield.fromAnnotation`, `bind.body`
- Pass 2: `mark.assist({ motivation: 'linking', instructions: ... })`

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `MATCH_THRESHOLD` | env var | 30 | Cluster-merge / match threshold |
| `SKIP_RELATIONSHIP_PASS` | env var | (off) | Set to `1` to skip pass 2 — useful for re-running only the promotion step |

## Tier-3 interactive checkpoint

Before pass 1: prints cluster summary, asks `confirm`. Per cluster (interactive only): per-synthesis confirm with the candidate text shown.

## Run it

**Prerequisite: `mark-named-entities` (skill 2) has been run.**

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/build-party-graph/script.ts'
```

Add `-e SEMIONT_INTERACTIVE=1 -it` for the per-cluster confirms.

## Guidance for the AI assistant

- **Foundational for descriptive-reference resolution.** Skill 6 (`resolve-descriptive-references`) needs Party resources to bind against. Run this skill before skill 6.
- **Cluster-merge is exact-text.** Two surface forms ("Acme Corp" vs. "Acme Corporation") that should refer to one Party still cluster as separate entries unless the match-search step pulls them together. The interactive checkpoint surfaces the candidate clusters, letting the user steer merges manually for the first run. After the first run synthesizes Party resources, subsequent re-runs match each cluster against the existing resources via `match.search` — meaning the *system gets smarter as it runs*. If you spot near-duplicate Party resources after a run, hand-merging them via the Semiont browser preserves the binding annotations.
- **Re-running is idempotent for already-bound annotations.** Annotations with an existing SpecificResource body are skipped. New annotations from later `mark-named-entities` runs get processed.
