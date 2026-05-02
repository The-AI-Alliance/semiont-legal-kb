---
name: mark-descriptive-references
description: Detect anaphoric mentions in legal documents — phrases that refer to entities without naming them ("the landlord", "the vendor", "the owner of the property", "the Client"). Feeds skill 6's resolution work.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user detect *descriptive* (non-named) entity references in a legal-document corpus. Legal text is unusually dense with these — defined terms like "the Client" and "the Vendor", role labels like "the Landlord" and "the Subtenant", and elaborated descriptions like "the owner of the property" or "the holder of the senior lien".

This is one of four tier-1 marking skills. It uses `mark.assist` with `motivation: 'linking'` and **`includeDescriptiveReferences: true`** to surface anaphoric mentions specifically. Pairs with `mark-named-entities` (skill 2) which catches the formally-named spans.

## What it does

For each markdown corpus resource (or one specific resource), runs `mark.assist({ motivation: 'linking', includeDescriptiveReferences: true })`. Tags spans like "the Client", "the prior party", "the holder of …", "the parties hereto", etc.

PDF resources are skipped.

## SDK verbs

- `browse.resources` — find markdown corpus targets
- `mark.assist({ motivation: 'linking', includeDescriptiveReferences: true })`

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `<resourceId>` | CLI arg (optional) | all markdown corpus resources | Scope to one |

## Tier-3 interactive checkpoint

Before run: prints target count, asks `confirm`.

## Run it

**Prerequisite: `ingest-corpus` has been run.**

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/mark-descriptive-references/script.ts'
```

Add `-e SEMIONT_INTERACTIVE=1 -it` for the confirm prompt.

## Guidance for the AI assistant

- **Why a separate skill from `mark-named-entities`?** Same SDK call, different `includeDescriptiveReferences` flag. Splitting them lets a user run one without the other (e.g., quickly tag named entities for downstream Party building, without paying for descriptive-reference detection at the same time). They can also be retuned independently — the `instructions` parameter for one doesn't muddle the other.
- **Resolution happens in skill 6.** `resolve-descriptive-references` walks every annotation this skill creates, gathers context, matches against Party resources, and binds where evidence supports it.
- **Re-running adds annotations cumulatively.** No deduplication.
