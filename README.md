# Legal Knowledge Base (Synthetic Documents)

A collection of **synthetic but realistic legal documents** — contracts, attorney correspondence, and internal memos — formatted for demonstration of legal-domain annotation and review workflows with [Semiont](https://github.com/The-AI-Alliance/semiont).

## About This Dataset

This repository contains synthetic legal materials in two subsets. All company names, parties, terms, and agreements are entirely fictional — the documents resemble authentic legal materials while containing no actual confidential or proprietary information.

- **[`legal_acme_msa/`](legal_acme_msa/)** — Five PDF documents from an Acme Corporation vendor review: a draft Master Services Agreement, a Data Processing Addendum, an IP side letter, an email negotiation excerpt, and a firm IP policy.
- **[`legal_counsel/`](legal_counsel/)** — Three markdown documents covering attorney workflows: a contract draft, an attorney email discussing revisions and IP licensing, and an internal counsel letter about contract review deadlines and due diligence.

The materials incorporate standard legal language and formatting conventions, common contractual clauses (confidentiality, IP licensing, indemnification), realistic business scenarios, and typical attorney-client correspondence patterns.

This corpus is well-suited for testing extraction of legal entities (parties, attorneys, addresses, dates); identifying contractual terms and obligations; tracking document revision history and redlines; extracting key deadlines and action items; and mapping relationships between related legal documents.

> **Disclaimer:** These documents are synthetic training materials. They should NOT be used as legal templates, do NOT constitute legal advice, have NOT been reviewed by legal professionals for accuracy, and are NOT suitable for any actual legal purpose. They are purely educational tools designed to demonstrate natural language processing and information extraction techniques on legal-domain content.

## Quick Start

Explore this dataset using [Semiont](https://github.com/The-AI-Alliance/semiont), an open-source knowledge base platform for annotation and knowledge extraction.

This repo follows the same layout and startup flow as [`semiont-template-kb`](https://github.com/The-AI-Alliance/semiont-template-kb). See its README for full setup instructions:

- [Quick Start: Local](https://github.com/The-AI-Alliance/semiont-template-kb#quick-start-local) — run the backend stack on your machine via `.semiont/scripts/start.sh`
- [Quick Start: Codespaces](https://github.com/The-AI-Alliance/semiont-template-kb#quick-start-codespaces) — launch a preconfigured backend in the cloud
- [Inference Configuration](https://github.com/The-AI-Alliance/semiont-template-kb#inference-configuration) — Ollama (local) vs. Anthropic (cloud) configs

### Open in Codespaces

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new/The-AI-Alliance/semiont-legal-kb)

> **Before launching:** add `ANTHROPIC_API_KEY` as a [user secret](https://github.com/settings/codespaces) with this repo selected. Otherwise the backend comes up but inference is non-functional until you add the secret and rebuild the container.

## License

Apache 2.0 — See [LICENSE](LICENSE) for details.
