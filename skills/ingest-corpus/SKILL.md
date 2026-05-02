---
name: ingest-corpus
description: Walk the repo's legal-document corpus (top-level subdirectories holding markdown and PDF documents, plus optional curated/context articles) and create one Semiont resource per file with appropriate entity types.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping a user bootstrap a legal-document corpus into a Semiont knowledge base. This is the foundation skill — every other skill in this repo operates against the resources this one creates.

## What it does

1. Calls `discoverCorpus()` (in [`src/files.ts`](../../src/files.ts)) to walk the conventional directory layout.
2. For each ingestable file, calls `yield.resource(...)` with appropriate `format` and `entityTypes`.

The directory convention:

| Path | Treated as | Default entity types |
|---|---|---|
| `<top-level-dir>/*.md` | corpus markdown document | filename-derived (`Contract`, `Email`, `Letter`, `Policy`, `Memo`, `Amendment`, `SideLetter`, `Exhibit`, `LegalOpinion`, `CorporateRecord`, or `LegalDocument`) |
| `<top-level-dir>/*.pdf` | corpus PDF document | same filename-derived types as above |
| `context/*.md`, `curated/*.md`, `generated/*.md` | pre-curated context article | `LegalContext`, `Curated` + filename-derived |

Filename heuristics (case-insensitive substring match): `agreement` / `msa` / `contract` / `sow` / `order form` → `Contract`; `addendum` / `exhibit` / `schedule` / `annex` → `Exhibit`; `amendment` / `redline` → `Contract, Amendment`; `side letter` → `Letter, SideLetter`; `email` / `message` → `Email`; `letter` / `memo` → `Letter`; `policy` → `Policy`; `minutes` / `resolution` / `consent` → `CorporateRecord`; `opinion` → `LegalOpinion`; everything else → `LegalDocument`.

`README.md`, `LICENSE`, `AGENTS.md`, `.DS_Store` and dotfiles are skipped. Build / config directories (`.git`, `.github`, `.devcontainer`, `.semiont`, `src`, `skills`, `node_modules`, `tests`, `docs`) are also skipped.

## SDK verbs

- `yield.resource` — one call per discovered file

## Tier-3 interactive checkpoint

Before bulk upload: `confirm` after showing the per-class summary.

## Run it

**Prerequisite: the Semiont backend is running** — see [AGENTS.md › Backend setup](../../AGENTS.md#backend-setup).

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/ingest-corpus/script.ts'
```

Add `-e SEMIONT_INTERACTIVE=1 -it` to enable the confirm prompt.

**Why the `HOST_ADDR` discovery probe:** `localhost` from inside a freshly-spawned container is its own loopback, not the host's. The probe uses the same trick `start.sh` uses. Substitute `docker run` or `podman run` for `container run` if those are your runtimes.

For Docker Desktop / Podman on macOS, replace the probe with `SEMIONT_API_URL=http://host.docker.internal:4000`. For Linux Docker, `--network host` + `SEMIONT_API_URL=http://localhost:4000` works.

## Output

Per-file resource id and entity types. Note these — downstream skills (`mark-named-entities`, `mark-descriptive-references`, etc.) operate against the resource set this skill creates.

## Guidance for the AI assistant

- **Re-running creates duplicates.** No deduplication. Use `semiont.browse.resources({ search: '<title>' })` to check before re-running, or restart the backend stack to start fresh.
- **PDFs are cataloged but not analyzed.** `mark.assist` requires `text/markdown` or `text/plain`. Tier-1 mark skills filter on media type and skip PDFs automatically. The markdown subset of the corpus carries the analytical workload.
- **Pre-curated context articles survive.** Drop a markdown file into `context/`, `curated/`, or `generated/` and skill 1 ingests it as a `LegalContext` resource on day 1; downstream synthesis skills `match.search` against existing `LegalContext` resources before creating new ones.
