---
name: resolve-descriptive-references
description: Walk every descriptive-reference annotation from skill 3, gather context, match against Party resources, bind where evidence supports it, and synthesize an Investigation resource that aggregates the resolution decisions.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read, Write
---

You are helping the user **resolve descriptive references** — the anaphoric mentions skill 3 surfaced ("the landlord", "the vendor", "the owner of the property", "the holder of the lien"). For each, the skill walks evidence, picks a Party resource if one fits, and binds. Across the run, it produces an **Investigation resource** that documents the resolution path.

The Investigation is the demonstration value. Even when individual bindings are uncertain, the audit trail — *here are the descriptive references we found, here are the candidates we considered, here's how we decided* — is itself a queryable artifact in the KB.

## What it does

1. `browse.annotations` across the markdown corpus; collect every `linking`-motivation annotation that *isn't* tagged Person/Organization (these are skill 3's descriptive-reference output) and isn't already bound.
2. For each annotation:
   - `gather.annotation` to fetch surrounding context.
   - `match.search` against Party resources in the KB.
   - If a candidate scores ≥ `MATCH_THRESHOLD`: `bind.body` adds *both* a `SpecificResource` body (the resolution itself) *and* a `TextualBody` with `purpose: 'commenting'` (the audit trail — top candidate name + score + competing candidates considered).
   - Otherwise: leave the annotation unresolved, but record the decision in the Investigation.
3. After the loop: `yield.resource` an **Investigation resource** (`entity types: ['Investigation', 'Aggregate']`) whose body is a markdown report — table of every reference with its resolution (or `unresolved`), narrative section noting the decisions and their evidentiary support.

## SDK verbs

- `browse.annotations`, `gather.annotation`, `match.search`, `bind.body`, `yield.resource` (Investigation)

## Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `MATCH_THRESHOLD` | env var | 30 | Tune match-acceptance threshold |
| `INVESTIGATION_NAME` | env var | `Descriptive-reference investigation` | Custom name for the synthesized Investigation resource |

## Tier-3 interactive checkpoint

Before run: prints reference count + threshold, asks `confirm`. Per borderline match (interactive only): top candidates with scores; `[b]ind / [s]kip / [n]ew Party / quit?`.

## Run it

**Prerequisites: `mark-named-entities` (with the default `INCLUDE_DESCRIPTIVE_REFERENCES=1`) and `build-party-graph` have been run.** `mark-named-entities` produces the descriptive-reference annotations this skill resolves; `build-party-graph` produces the Party resources it matches against.

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/resolve-descriptive-references/script.ts'
```

Add `-e SEMIONT_INTERACTIVE=1 -it` for the per-match prompts.

## Guidance for the AI assistant

- **The Investigation is the demonstration.** Even with imperfect resolution, the *audit trail* is the primary deliverable. A future audit can ask "how did we conclude that 'the property owner' meant Party X?" and get an answer back from the KB.
- **`MATCH_THRESHOLD` is conservative.** A reference may genuinely be ambiguous from text alone (multiple parties could be "the holder"); the threshold leaves those references unresolved rather than binding speculatively. The Investigation surfaces the unresolved ones too.
- **The corpus shapes what gets resolved.** If the descriptive reference's referent isn't in the corpus (e.g. "the regulator" with no named regulator anywhere in the documents), the skill correctly leaves it unresolved. That's a feature — the Investigation tells the user *what's missing from the corpus* as much as *what's there*.
- **Re-run after seeding more Party resources.** The match step gets sharper as the Party graph fills out. A second run after adding context (curated context articles, or hand-promoted Party resources) typically resolves more.
