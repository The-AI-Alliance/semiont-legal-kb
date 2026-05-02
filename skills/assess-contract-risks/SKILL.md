---
name: assess-contract-risks
description: Flag risk-prone clauses in contract documents — open issues, missing definitions, vague language, asymmetric provisions, gaps in coverage. Outputs assessing annotations.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user surface the language in a contract that needs counsel's attention. The default focus mirrors what a transactional attorney scanning for issues would zero in on: asymmetric obligations, missing or vague definitions, survivability gaps, and any clause whose plain reading produces ambiguity.

## What it does

For each markdown corpus resource (or one specific resource), runs `mark.assist({ motivation: 'assessing', instructions: ... })`. Each flagged span is queryable as an annotation; later, `build-due-diligence-checklist` (skill 10) aggregates the corpus's flagged work into a single Checklist resource.

PDFs are skipped (mark.assist requires text input).

## SDK verbs

- `browse.resources` — find markdown corpus targets
- `mark.assist({ motivation: 'assessing', instructions: ... })`

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `<resourceId>` | CLI arg (optional) | all markdown corpus resources | Scope to one |
| `ASSESS_INSTRUCTIONS` | env var | IP / indemnification / data / asymmetry focus (see script) | Replace the focus directive |

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
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/assess-contract-risks/script.ts'
```

Override the focus per matter:

```bash
... -e ASSESS_INSTRUCTIONS='Focus on data-protection obligations, breach notification timelines, and indemnification carve-outs. Flag asymmetric obligations, undefined terms, and survivability gaps.' ...
```

Add `-e SEMIONT_INTERACTIVE=1 -it` for the confirm prompt.

## Guidance for the AI assistant

- **Tune the instructions per matter.** The default scope is broad; in practice every matter has a specific focus area. Setting `ASSESS_INSTRUCTIONS` to the matter's actual focus narrows the model's attention without editing the script.
- **Assessing annotations feed two downstream skills.** Skill 10 (`build-due-diligence-checklist`) aggregates them into a Checklist resource. A future "remediation-suggester" skill could walk each assessing annotation and propose redline fixes.
