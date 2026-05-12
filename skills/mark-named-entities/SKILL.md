---
name: mark-named-entities
description: Detect entity spans across the markdown corpus — Person, Organization, Address, Date, MonetaryValue, LegalSection, LegalDocument, LegalTerm — surfacing both formally-named mentions ("Acme Corporation", "1247 Oak Street") and descriptive references ("the Vendor", "the landlord", "the owner of the property"). Tags spans for resolution by tier-2 skills.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user detect entity mentions across a legal-document corpus.

This is one of the tier-1 marking skills. It uses `mark.assist` with motivation `linking` to tag every entity span, leaving each annotation unresolved (no `SpecificResource` body item yet). Tier-2 skills (`build-party-graph`, `build-section-graph`, `resolve-descriptive-references`) resolve them.

## What it does

For each markdown corpus resource (or one specific resource), runs `mark.assist({ motivation: 'linking', entityTypes: [...], includeDescriptiveReferences: true })`. The default type list spans the eight entity types most useful for legal review — people, organizations, addresses, dates, monetary values, document references, section references, and defined terms.

By default the pass surfaces BOTH formal mentions AND descriptive references (anaphora like "the Vendor" or "the holder of the senior lien"). The two classes share the same annotation shape; tier-2 resolution skills handle them uniformly. To restrict the pass to named entities only, set `INCLUDE_DESCRIPTIVE_REFERENCES=0`.

PDF resources are skipped; `mark.assist` requires `text/markdown` or `text/plain`.

## SDK verbs

- `browse.resources` — find markdown corpus targets
- `mark.assist({ motivation: 'linking', entityTypes: [...], includeDescriptiveReferences: true | false })`

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `<resourceId>` | CLI arg (optional) | all markdown corpus resources | Scope to one |
| `ENTITY_TYPES` | env var | `Person,Organization,Address,Date,MonetaryValue,LegalSection,LegalDocument,LegalTerm` | Override or extend |
| `INCLUDE_DESCRIPTIVE_REFERENCES` | env var | `1` | Set to `0` to skip descriptive-reference detection |

## Tier-3 interactive checkpoint

Before run: prints target count + entity types + descriptive-reference flag, asks `confirm`.

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

Override entity types with `-e ENTITY_TYPES='Person,Organization,Address'` for a narrower scope. Disable anaphora with `-e INCLUDE_DESCRIPTIVE_REFERENCES=0`. Add `-e SEMIONT_INTERACTIVE=1 -it` for the confirm prompt.

(See [`ingest-corpus`'s "Run it"](../ingest-corpus/SKILL.md#run-it) for networking notes.)

## Guidance for the AI assistant

- **Annotations stay unresolved.** Tier-2 skills cluster and promote, then bind these annotations.
- **Re-running adds annotations cumulatively.** No deduplication.
- **PDFs are silently skipped.** PDF resources do exist in the KB after ingest, but `mark.assist` only accepts text. A future PDF-to-markdown skill could lift the PDF body into a markdown resource for analysis.
- **Both classes of mention come from one call.** The worker prompt under `includeDescriptiveReferences: true` asks for both formal names and anaphora, scoped to the same `entityTypes` list. Don't run a second pass with `INCLUDE_DESCRIPTIVE_REFERENCES=0` after the default — it would produce duplicate named-entity annotations on the same spans.
