# AGENTS.md — semiont-legal-kb (and any legal-document KB)

This is a legal-document-flavored Semiont knowledge base. The corpus is contracts, attorney correspondence, exhibits, and policies. The skills detect parties, sections, descriptive references, obligations, and risk-prone clauses in the documents and build out structured layers around them — Party resources, a section graph, an obligation register, an investigation trail, a due-diligence checklist, and a redline-version history.

If you're an AI assistant working in this repo, this file is your orientation. The skills are **corpus-generic** — drop a different legal-document corpus into the same directory layout and they work without modification.

## What's here

- **Top-level subdirectories** (e.g., `<matter-name>/`, `<vendor-name>/`, `<case-name>/`) — each holds the documents for one matter. Each file becomes one resource via skill 1. PDFs are cataloged as binary; markdown is what subsequent skills analyze.
- **`context/`, `curated/`, or `generated/`** (optional) — pre-curated context articles. Skill 1 ingests them as `LegalContext` resources on day 1 and downstream skills *match* against them rather than overwriting.
- **`src/`** — small helper modules:
  - `src/files.ts` — corpus discovery and classification by filename heuristic
  - `src/parties.ts` — fast pattern-detection for party-name candidates (organization suffixes, professional titles), used as a pre-filter
  - `src/diff.ts` — section-aware contract diff, used by `redline-tracker`
  - `src/interactive.ts` — `confirm` / `pick` / `preview` helpers for tier-3 interactive checkpoints
- **`skills/`** — eleven skills, each shipping a `SKILL.md` plus a `script.ts` that uses `@semiont/sdk` against the running backend.

| Skill | What it does | New SDK verbs |
|---|---|---|
| [`ingest-corpus`](skills/ingest-corpus/) | Walk the repo, declare the KB's entity-type vocabulary, create one resource per file | `frame.addEntityTypes`, `yield.resource` |
| [`mark-named-entities`](skills/mark-named-entities/) | Detect Person, Organization, Address, Date, MonetaryValue, LegalSection, LegalDocument, LegalTerm spans — both formal mentions and descriptive references ("the landlord", "the vendor") | `mark.assist` (linking, optionally with `includeDescriptiveReferences`) |
| [`assess-contract-risks`](skills/assess-contract-risks/) | Flag risk-prone clauses (asymmetric provisions, vague language, missing definitions) | `mark.assist` (assessing) |
| [`comment-action-items`](skills/comment-action-items/) | Surface action items, deadlines, required follow-ups | `mark.assist` (commenting) |
| [`build-party-graph`](skills/build-party-graph/) | Promote Person/Organization mentions to Party resources, encode inter-party relationships | `+ yield.fromAnnotation`, `bind.body`, `match.search` |
| [`resolve-descriptive-references`](skills/resolve-descriptive-references/) | Walk descriptive references, resolve where evidence exists, synthesize an Investigation resource | `+ gather.annotation` |
| [`build-section-graph`](skills/build-section-graph/) | Decompose contracts into per-section LegalSection resources, bind cross-document references | `+ yield.resource` per section |
| [`extract-obligations`](skills/extract-obligations/) | Tag every duty / covenant / restriction; synthesize an Obligation resource per | full pipeline composition |
| [`build-due-diligence-checklist`](skills/build-due-diligence-checklist/) | Aggregate action items into a Checklist resource | `browse.annotations`, `gather.annotation`, `yield.resource` |
| [`redline-tracker`](skills/redline-tracker/) | Track contract evolution; per-change VersionDelta resources with provenance | `mark.annotation` (linking with `supersedes`), `+ yield.resource` per delta |

## What does legal review involve?

Working legal review and document analysis usually involves several braided activities:

1. **Cataloging** — what documents exist; what relationships hold between them.
2. **Party identification** — formally-named parties, plus the descriptive references ("the client", "the landlord") that point at them.
3. **Section navigation** — contracts cite their own sections and exhibits; correspondence cites into the contract; cross-document references should be navigable.
4. **Obligation extraction** — who owes what to whom, by when, under what conditions.
5. **Risk assessment** — open issues, missing definitions, vague language, asymmetric provisions, gaps in coverage.
6. **Action items** — what's pending, what's due when, who needs to sign what.
7. **Version tracking** — contracts go through redline rounds; understanding what changed between versions, and why, is core to negotiation history.
8. **Investigation trails** — resolving uncertainties (which entity holds title to X? whose responsibility is Y?) often requires walking a chain of evidence; the resolution path itself is an artifact worth preserving.

The Semiont SDK is well-suited for all eight. The skills are organized to demonstrate that — turning a raw set of legal documents into a navigable network of Party, LegalSection, Obligation, Investigation, Checklist, and VersionDelta resources, all anchored back to the source paragraphs.

## Pre-curated context articles are preserved

Drop a markdown file into `context/`, `curated/`, or `generated/` and skill 1 ingests it as a `LegalContext` resource on day 1. Skills that synthesize new context articles `match.search` against existing ones first, so any hand-curated content survives subsequent runs.

## Entity types used in this KB

- **People & orgs**: `Person`, `Organization`, `Party` (Party = a Person or Organization promoted to a first-class resource by `build-party-graph`)
- **Where & when & how much**: `Address`, `Date`, `MonetaryValue`
- **Document types**: `Contract`, `Amendment`, `Exhibit`, `Email`, `Letter`, `SideLetter`, `Policy`, `Memo`, `LegalOpinion`, `CorporateRecord`, `LegalDocument`
- **Inside-document references**: `LegalSection` (numbered sections of structured documents), `LegalTerm` (defined terms inside contracts)
- **Synthesized aggregates**: `Obligation`, `Investigation`, `Checklist`, `VersionDelta`, `Relationship`
- **Curated content marker**: `Curated`, `LegalContext`

## Worked example: tracking down an unknown counterparty

The seeded corpus contains a markdown subdirectory whose documents talk about a property whose owner is named in one document but referred to descriptively elsewhere ("the owner of the property", "the landlord"). After running:

1. `ingest-corpus` → resources for each document.
2. `mark-named-entities` → annotations on every entity mention — the formal organization names AND the descriptive references ("the owner of …", "the landlord") — in one `mark.assist` pass.
3. `build-party-graph` → Party resources for every distinct named entity.
4. `resolve-descriptive-references` → walks each descriptive-reference annotation, gathers context, matches against Party resources, binds where evidence supports it, and produces an **Investigation resource** narrating the resolution path.

The Investigation resource is the demonstration — a queryable artifact that shows *how* an unknown counterparty was tracked down, citing the exact source paragraphs. This pattern works on any legal corpus: drop in your own documents, run the skills, get an Investigation that traces however many descriptive references your text contains. Specific names from the seeded corpus appear *only in the Investigation that the run produces*; the skills themselves never hard-code any party, address, exhibit, or matter name.

## Working in containers — do not install npm packages on the host

This template assumes a containerized workflow. The backend stack runs in containers (`semiont start` brings it up); the skills run in containers too. There is **no need** to install Node, the SDK, or any other tooling on the host machine.

Each skill's `SKILL.md` shows a `container run` invocation that mounts the repo, installs `@semiont/sdk` and `tsx` *inside* a throwaway container, then runs the skill's `script.ts`. See [`skills/ingest-corpus/SKILL.md`](skills/ingest-corpus/SKILL.md) for the full networking discussion (the `HOST_ADDR` discovery probe).

## Backend setup

Before running any skill, the Semiont backend stack must be up. Two paths:

### Local: `semiont start`

```bash
brew install the-ai-alliance/semiont/semiont   # once
semiont start
```

Then create the admin user you'll sign in with:

```bash
semiont useradd --email admin@example.com --password password --admin
```

Flags: `--config anthropic` for cloud inference (requires `ANTHROPIC_API_KEY`), `--no-observe` to skip the Jaeger sidecar (on by default; traces at http://localhost:16686), `--runtime` to force a container runtime. `--config`/`--runtime` are sticky — a bare `semiont start` repeats the last explicitly-passed values. `--help` lists all options.

### Codespaces

Open the repo in a Codespace — `post-create.sh` pulls the stack's images, `post-start.sh` brings it up, admin credentials are auto-generated into `.devcontainer/admin.json`. Print them: `cat .devcontainer/admin.json`. Forward the port: `gh codespace ports forward 4000:4000`.

## Parameterization and interactivity

Skills are parameterized in three tiers.

### Tier 1 — environment configuration

| Var | Purpose |
|---|---|
| `SEMIONT_API_URL` | Backend URL (default `http://localhost:4000`) |
| `SEMIONT_USER_EMAIL` | Authenticating user |
| `SEMIONT_USER_PASSWORD` | Authenticating user's password |

### Tier 2 — skill-invocation parameters

Per-skill env vars and CLI args. Most skills accept `MATCH_THRESHOLD` (default 30) for cluster-merge / candidate binding. Tier-1 mark skills accept `ENTITY_TYPES` to override the default type list. Instruction text for `assess-*` / `comment-*` / `extract-obligations` skills is exposed as `ASSESS_INSTRUCTIONS` / `COMMENT_INSTRUCTIONS` / `OBLIGATION_INSTRUCTIONS` so users can retune focus without editing TypeScript. `redline-tracker` takes the prior version's resourceId and the new version's path as CLI args. See each skill's `SKILL.md` for specifics.

### Tier 3 — interactive checkpoints

Off by default (batch automation works as before). Enable per-run with `--interactive` (CLI flag) or `SEMIONT_INTERACTIVE=1` (env var). Skills pause at natural decision points and show what they found / what they're about to do, letting the user steer.

The same render-what-found logic runs in non-interactive mode — output goes to logs instead of pausing for input.

Tier-2 env vars can pre-answer tier-3 prompts (e.g., `MATCH_THRESHOLD=25` pre-answers cluster-merge confidence; `ASSESS_INSTRUCTIONS=…` pre-answers focus selection). The "interactive once, scripted thereafter" workflow falls out naturally.

## A note on PDFs

`mark.assist` operates on `text/markdown` and `text/plain`. PDFs are ingested by skill 1 as `application/pdf` resources — they're cataloged and visible in the KB but downstream `mark-*` skills skip them. The markdown subset of the corpus carries the analytical workload. PDF-to-markdown conversion (via `pdftotext`, `pandoc`, or a containerized `tika`) can be added to skill 1 in a future enhancement when a skill genuinely needs PDF body content.

## Background reading

| Where | What |
|---|---|
| [`@semiont/sdk` README](https://github.com/The-AI-Alliance/semiont/tree/main/packages/sdk) | The TypeScript surface — eight verbs (frame, yield, mark, match, bind, gather, browse, beckon) plus admin/auth/job. |
| [SDK Usage docs](https://github.com/The-AI-Alliance/semiont/tree/main/packages/sdk/docs) | Cache semantics, reactive model, state units, error handling. |
| [Semiont protocol docs](https://github.com/The-AI-Alliance/semiont/tree/main/docs/protocol) | The eight-flow framing. |
| [Semiont protocol skills](https://github.com/The-AI-Alliance/semiont/tree/main/docs/protocol/skills) | Reference skill packs — `semiont-wiki`, `semiont-comment`, `semiont-highlight`, etc. |
| [.plans/LEGAL-SKILLS.md](.plans/LEGAL-SKILLS.md) | The full design plan for these skills. |
