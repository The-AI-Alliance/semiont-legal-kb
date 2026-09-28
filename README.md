# Legal Knowledge Base (Synthetic Documents)

[![Lint](https://github.com/The-AI-Alliance/semiont-legal-kb/actions/workflows/lint.yml/badge.svg?branch=main)](https://github.com/The-AI-Alliance/semiont-legal-kb/actions/workflows/lint.yml?query=branch%3Amain)
[![License](https://img.shields.io/github/license/The-AI-Alliance/semiont-legal-kb)](https://github.com/The-AI-Alliance/semiont-legal-kb/blob/main/LICENSE)

A collection of **synthetic but realistic legal documents** — contracts, attorney correspondence, and internal memos — formatted for demonstration of legal-domain annotation and review workflows with [Semiont](https://github.com/The-AI-Alliance/semiont).

## About This Dataset

This repository contains synthetic legal materials in two subsets. All company names, parties, terms, and agreements are entirely fictional — the documents resemble authentic legal materials while containing no actual confidential or proprietary information.

- **[`legal_acme_msa/`](legal_acme_msa/)** — Five PDF documents from an Acme Corporation vendor review: a draft Master Services Agreement, a Data Processing Addendum, an IP side letter, an email negotiation excerpt, and a firm IP policy.
- **[`legal_counsel/`](legal_counsel/)** — Three markdown documents covering attorney workflows: a contract draft, an attorney email discussing revisions and IP licensing, and an internal counsel letter about contract review deadlines and due diligence.

The materials incorporate standard legal language and formatting conventions, common contractual clauses (confidentiality, IP licensing, indemnification), realistic business scenarios, and typical attorney-client correspondence patterns.

This corpus is well-suited for testing extraction of legal entities (parties, attorneys, addresses, dates); identifying contractual terms and obligations; tracking document revision history and redlines; extracting key deadlines and action items; and mapping relationships between related legal documents.

> **Disclaimer:** These documents are synthetic training materials. They should NOT be used as legal templates, do NOT constitute legal advice, have NOT been reviewed by legal professionals for accuracy, and are NOT suitable for any actual legal purpose. They are purely educational tools designed to demonstrate natural language processing and information extraction techniques on legal-domain content.

## Skills

This repo ships eleven skills that build a layered legal-review KB on top of the Semiont SDK. See [AGENTS.md](AGENTS.md) for the full design discussion.

| Skill | What it does |
|---|---|
| [`ingest-corpus`](skills/ingest-corpus/SKILL.md) | Walk the repo's legal-document corpus (markdown and PDF); create one resource per file. |
| [`mark-named-entities`](skills/mark-named-entities/SKILL.md) | Detect entity spans — Person, Organization, Address, Date, MonetaryValue, LegalSection, LegalTerm — surfacing both formal mentions and descriptive references ("the landlord", "the vendor", "the owner of the property"). |
| [`assess-contract-risks`](skills/assess-contract-risks/SKILL.md) | Flag risk-prone clauses — open issues, missing definitions, vague language, asymmetric provisions. |
| [`comment-action-items`](skills/comment-action-items/SKILL.md) | Surface action items, deadlines, and required follow-ups across the corpus. |
| [`resolve-descriptive-references`](skills/resolve-descriptive-references/SKILL.md) | Resolve descriptive references to Party resources; synthesize an Investigation resource documenting the audit trail. |
| [`build-section-graph`](skills/build-section-graph/SKILL.md) | Decompose a structured legal document into per-section LegalSection resources; bind cross-document section references. |
| [`extract-obligations`](skills/extract-obligations/SKILL.md) | Tag every obligation; synthesize Obligation resources with structured fields (obligor, obligee, trigger, deadline). |
| [`build-party-graph`](skills/build-party-graph/SKILL.md) | Promote Person/Organization mentions to canonical Party resources; extract inter-party relationships. |
| [`build-due-diligence-checklist`](skills/build-due-diligence-checklist/SKILL.md) | Aggregate commenting annotations into a single Checklist resource — the matter's living front page. |
| [`redline-tracker`](skills/redline-tracker/SKILL.md) | Track contract evolution: ingest a new version, link to prior, run section-aware diff, yield VersionDelta resources. |

## Quick Start

Explore this dataset using [Semiont](https://github.com/The-AI-Alliance/semiont), an open-source knowledge base platform for annotation and knowledge extraction.

This repo follows the same layout and startup flow as [`semiont-template-kb`](https://github.com/The-AI-Alliance/semiont-template-kb). See its README for full setup instructions:

- [Quick Start: Local](https://github.com/The-AI-Alliance/semiont-template-kb#quick-start-local) — run the Semiont stack on your machine via `semiont start`
- [Quick Start: Codespaces](https://github.com/The-AI-Alliance/semiont-template-kb#quick-start-codespaces) — launch a preconfigured stack in the cloud
- [Inference Configuration](https://github.com/The-AI-Alliance/semiont-template-kb#inference-configuration) — Ollama (local) vs. Anthropic (cloud) configs

### Open in Codespaces

**Prerequisites:** the [Semiont launcher](https://github.com/The-AI-Alliance/semiont/tree/main/apps/launcher) (`brew install the-ai-alliance/semiont/semiont`) and the [GitHub CLI (`gh`)](https://cli.github.com/), signed in with `gh auth login`.

> **Before creating:** add `ANTHROPIC_API_KEY` as a [user secret](https://github.com/settings/codespaces) with this repo selected. Otherwise the stack comes up but inference is non-functional until you add the secret and rebuild the container.

One command creates the codespace (or resumes the one you already have), waits for the stack to answer, forwards the KB to your machine, and starts the browser locally when this machine has a container runtime:

```bash
semiont start --runtime codespace --repo The-AI-Alliance/semiont-legal-kb
```

Signing in needs the codespace's Keycloak, which the launcher does not forward. Forward it yourself and leave it running; the start summary names the codespace, and so does `gh codespace list`. Every codespace KB's Keycloak is on 8080, so this machine signs into one codespace KB at a time:

```bash
gh codespace ports forward 8080:8080 -c <codespace>
```

No account exists until you make one, and `semiont useradd` cannot reach a codespace KB. Create the first account with Keycloak's own admin tool inside the codespace; it prompts for the password:

```bash
gh codespace ssh -c <codespace> -- -t "docker exec -it semiont-keycloak bash -c 'K=/opt/keycloak/bin/kcadm.sh; \$K config credentials --server http://localhost:8080 --realm master --user admin --password \"\$KC_BOOTSTRAP_ADMIN_PASSWORD\" && \$K create users -r semiont -s username=<email> -s email=<email> -s emailVerified=true -s enabled=true && \$K set-password -r semiont --username <email>'"
```

Open **http://localhost:3000** and add the KB in the **Knowledge Bases** panel: Host `localhost`, and the port the launcher printed. **Connect** sends you to Keycloak; sign in with the email and password you just set, and give your name the first time.

`semiont stop --repo The-AI-Alliance/semiont-legal-kb` stops compute (storage bills until GitHub deletes the codespace, 30 days on); add `--delete` to destroy it now. It leaves your 8080 forward running. A codespace whose setup failed during `start` is unknown to `semiont stop`; delete it with `gh codespace delete -c <codespace>`.

<details>
<summary>Without the launcher: the raw <code>gh</code> recipe</summary>

```bash
gh codespace create --repo The-AI-Alliance/semiont-legal-kb --machine premiumLinux
gh codespace ports forward 3000:3000 4000:4000 8080:8080 -c <codespace>   # leave running
```

In another terminal, create the first account with the Keycloak command above. This forwards the codespace's own browser as well: open **http://localhost:3000**, add Host `localhost`, Port `4000`, and **Connect**. If `gh` rejects the forward with `must have admin rights to Repository`, grant the scope once: `gh auth refresh -h github.com -s codespace`.

</details>

## License

Apache 2.0 — See [LICENSE](LICENSE) for details.
