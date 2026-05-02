---
name: mark-named-entities
description: Detect formally-named entity spans across the markdown corpus — Person, Organization, Address, Date, MonetaryValue, LegalSection, LegalDocument, LegalTerm. Tags spans for resolution by tier-2 skills.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user detect named-entity mentions across a legal-document corpus.

This is one of four tier-1 marking skills. It uses `mark.assist` with motivation `linking` to tag every formally-named entity span, leaving each annotation unresolved (no SpecificResource body item yet). Tier-2 skills (`build-party-graph`, `build-section-graph`) resolve them.

## What it does

For each markdown corpus resource (or one specific resource), runs `mark.assist({ motivation: 'linking', entityTypes: [...] })`. The default type list spans the eight entity types most useful for legal review — people, organizations, addresses, dates, monetary values, document references, section references, and defined terms.

PDF resources are skipped; `mark.assist` requires `text/markdown` or `text/plain`.

## SDK verbs

- `browse.resources` — find markdown corpus targets
- `mark.assist({ motivation: 'linking', entityTypes: [...] })`

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `<resourceId>` | CLI arg (optional) | all markdown corpus resources | Scope to one |
| `ENTITY_TYPES` | env var | `Person,Organization,Address,Date,MonetaryValue,LegalSection,LegalDocument,LegalTerm` | Override or extend |

## Tier-3 interactive checkpoint

Before run: prints target count + entity types, asks `confirm`.

## Run it

**Prerequisite: `ingest-corpus` has been run.**

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/mark-named-entities/script.ts'
```

Override entity types with `-e ENTITY_TYPES='Person,Organization,Address'` for a narrower scope. Add `-e SEMIONT_INTERACTIVE=1 -it` for the confirm prompt.

(See [`ingest-corpus`'s "Run it"](../ingest-corpus/SKILL.md#run-it) for networking notes.)

## Guidance for the AI assistant

- **Annotations stay unresolved.** Skills 9 (`build-party-graph`) and 7 (`build-section-graph`) cluster and promote to first-class resources, then bind these annotations.
- **Re-running adds annotations cumulatively.** No deduplication.
- **PDFs are silently skipped.** PDF resources do exist in the KB after ingest, but `mark.assist` only accepts text. A future PDF-to-markdown skill could lift the PDF body into a markdown resource for analysis.
