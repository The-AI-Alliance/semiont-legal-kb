# Legal Knowledge Base (Synthetic Documents)

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

- [Quick Start: Local](https://github.com/The-AI-Alliance/semiont-template-kb#quick-start-local) — run the backend stack on your machine via `.semiont/scripts/start.sh`
- [Quick Start: Codespaces](https://github.com/The-AI-Alliance/semiont-template-kb#quick-start-codespaces) — launch a preconfigured backend in the cloud
- [Inference Configuration](https://github.com/The-AI-Alliance/semiont-template-kb#inference-configuration) — Ollama (local) vs. Anthropic (cloud) configs

### Open in Codespaces

Install the [GitHub CLI (`gh`)](https://cli.github.com/) if you haven't already.

> **Before creating:** add `ANTHROPIC_API_KEY` as a [user secret](https://github.com/settings/codespaces) with this repo selected. Otherwise the backend comes up but inference is non-functional until you add the secret and rebuild the container.

Create the codespace on a premium machine for faster builds and more headroom:

```bash
gh codespace create --repo The-AI-Alliance/semiont-legal-kb --machine premiumLinux
```

Forward the backend port to your local machine, then fetch the auto-generated admin credentials:

```bash
gh codespace ports forward 4000:4000
gh codespace ssh -- cat .devcontainer/admin.json
```

The credentials let you log in via the Semiont browser — see [Quick Start: Codespaces](https://github.com/The-AI-Alliance/semiont-template-kb#quick-start-codespaces) on the template-kb README for the full browser-side flow.

## License

Apache 2.0 — See [LICENSE](LICENSE) for details.
