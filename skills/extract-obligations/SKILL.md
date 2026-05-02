---
name: extract-obligations
description: Tag every obligation, duty, covenant, or restriction in a contract; synthesize an Obligation resource per detected obligation with structured fields (obligor, obligee, trigger, deadline, source-section reference); bind the source annotation to the new resource.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user build the **obligation register** for a contract — a queryable layer where every "X shall…", "prior written consent…", "survival period of N years…" is its own resource with structured fields.

This is a tier-2 skill, similar in shape to `build-party-graph` (skill 9): a `mark.assist` pass tags the spans, then a per-annotation `yield.fromAnnotation` synthesizes one Obligation resource per detected obligation.

## What it does

Given the resource id of a contract document (or the corpus at large):

1. `mark.assist({ motivation: 'linking', entityTypes: ['Obligation'], instructions: ... })` — tags every obligation, duty, covenant, or restriction span.
2. Walks the new annotations:
   - `gather.annotation` for context.
   - `yield.fromAnnotation` to synthesize an Obligation resource. The model fills in structured fields in the body markdown: obligor, obligee, trigger, deadline / duration, source-section reference, plain-language summary.
   - `bind.body` to link the source span to the Obligation resource.

The `Obligation` entity-type tag is what `build-due-diligence-checklist` (skill 10) and any future "obligation-tracker" tooling key off of.

## SDK verbs

- `browse.resources`, `mark.assist({ motivation: 'linking', entityTypes: ['Obligation'], instructions: ... })`, `browse.annotations`, `gather.annotation`, `yield.fromAnnotation`, `bind.body`

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `<contractResourceId>` | CLI arg (optional) | all markdown corpus resources | Scope to one document |
| `OBLIGATION_INSTRUCTIONS` | env var | the standard obligation-extraction directive | Replace the focus directive |

## Tier-3 interactive checkpoint

Before the synthesis pass: prints obligation-annotation count, asks `confirm` (each yield.fromAnnotation costs an LLM call).

## Run it

**Prerequisite: `ingest-corpus` has been run.**

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/extract-obligations/script.ts'
```

To scope to one contract:

```bash
... npx tsx skills/extract-obligations/script.ts <contractResourceId> ...
```

Add `-e SEMIONT_INTERACTIVE=1 -it` for the synthesis-confirm prompt.

## Guidance for the AI assistant

- **Cost.** Two LLM passes — mark.assist (one call per resource) plus yield.fromAnnotation (one per obligation). On a large contract with hundreds of obligations, this is expensive. Scope to a single contract for first runs.
- **Body markdown structure.** The yield.fromAnnotation call passes `entityTypes: ['Obligation']` so the model knows the structured shape it's producing — obligor, obligee, trigger, duration, source section. Re-tune the directive in `OBLIGATION_INSTRUCTIONS` if you want different fields (e.g., a `material?` boolean for materiality screening).
- **Re-running adds Obligation resources cumulatively.** No deduplication. Restart the backend or delete existing Obligation resources via the Semiont browser before re-running.
- **Provenance is preserved.** Each Obligation resource has a binding annotation pointing back to the contract paragraph it came from. "Where in the contract does the obligation 'X shall provide annual reports' come from?" is a one-step query.
