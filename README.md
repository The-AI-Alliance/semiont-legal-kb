# Semiont Template Knowledge Base

[![Lint](https://github.com/The-AI-Alliance/semiont-template-kb/actions/workflows/lint.yml/badge.svg?branch=main)](https://github.com/The-AI-Alliance/semiont-template-kb/actions/workflows/lint.yml?query=branch%3Amain)
[![Build](https://github.com/The-AI-Alliance/semiont-template-kb/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/The-AI-Alliance/semiont-template-kb/actions/workflows/build.yml?query=branch%3Amain)
[![License](https://img.shields.io/github/license/The-AI-Alliance/semiont-template-kb)](https://github.com/The-AI-Alliance/semiont-template-kb/blob/main/LICENSE)
[![Use this template](https://img.shields.io/badge/use%20this-template-2ea44f?logo=github)](https://github.com/new?template_name=semiont-template-kb&template_owner=The-AI-Alliance)

A starting point for creating a new [Semiont](https://github.com/The-AI-Alliance/semiont) knowledge base. Clone this repo, add your documents, and run the start script to get a fully functional semantic wiki backed by AI-powered annotation, linking, and generation.

Pick one path — Local or Codespaces — and follow it end to end.

## Quick Start: Local

**Prerequisites:**

- A container runtime: [Apple Container](https://github.com/apple/container), [Docker](https://www.docker.com/), or [Podman](https://podman.io/)
- An inference provider: [Ollama](https://ollama.com/) for fully local inference, or an [Anthropic](https://www.anthropic.com/) API key for cloud inference. See [Inference Configuration](#inference-configuration) for details.
- [Git](https://git-scm.com/) — for managing your documents and committing the event streams that the backend stages

No npm or Node.js installation required — everything runs in containers.

### Start the backend

```bash
git clone https://github.com/The-AI-Alliance/semiont-template-kb.git my-kb
cd my-kb
.semiont/scripts/start.sh --email admin@example.com --password password
```

This builds and starts the full backend stack: PostgreSQL, Neo4j, Qdrant, Ollama, and the Semiont API server. The script auto-detects your container runtime.

### Browse the knowledge base

Start a Semiont browser by [running the container or desktop app](https://github.com/The-AI-Alliance/semiont#start-the-browser), then open it at **http://localhost:3000** and add your knowledge base in the **Knowledge Bases** panel:

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `4000` |
| Email | the email you passed to `--email` |
| Password | the password you passed to `--password` |

## Quick Start: Codespaces

For a KB you intend to keep, **[use this template](https://github.com/new?template_name=semiont-template-kb&template_owner=The-AI-Alliance) first to create your own repo**, then launch a Codespace from there — that gives you write access for committing your annotations and event streams. The badge below launches on this template directly; useful for trying out but read-only.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new/The-AI-Alliance/semiont-template-kb)

> **Before launching:** add `ANTHROPIC_API_KEY` as a [user secret](https://github.com/settings/codespaces) with your repo selected. Otherwise the backend comes up but inference is non-functional until you add the secret and rebuild the container.

### Start the backend

A Codespace builds the backend stack via `docker compose` with the anthropic config. First-time setup takes 5-10 minutes (image build, model pull). On every start, the configuration generates fresh admin credentials, saves them to `.devcontainer/admin.json`, and prints them in the startup banner.

### Browse the knowledge base

Forward the codespace's backend port to your local machine so the Semiont browser can reach it the same way it would a local backend:

```bash
gh codespace ports forward 4000:4000
```

If `gh` rejects this with `must have admin rights to Repository`, your `gh` install lacks the codespace OAuth scope. Grant it once and re-run:

```bash
gh auth refresh -h github.com -s codespace
```

Leave the forward running. Then start a Semiont browser by [running the container or desktop app](https://github.com/The-AI-Alliance/semiont#start-the-browser), open it at **http://localhost:3000**, and add your knowledge base in the **Knowledge Bases** panel:

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `4000` |
| Email | shown in the codespace startup banner (also in `.devcontainer/admin.json`) |
| Password | shown in the codespace startup banner (also in `.devcontainer/admin.json`) |

## Adding Documents

Add documents anywhere in the project root. They become resources in the knowledge base when you upload them through the UI or CLI. This repo is a Git repository — use `git` to track your documents, branch, and collaborate just as you would with any other project.

## Inference Configuration

The start script selects an inference config with the `--config` flag. Configs live in `.semiont/containers/semiontconfig/`:

- **`ollama-gemma`** (default for `start.sh`) — fully local inference via [Ollama](https://ollama.com/) with Gemma 4 models. No API key needed. On first run, Ollama pulls `gemma4:26b` (17 GB), `gemma4:e2b` (7.2 GB), and `nomic-embed-text` (274 MB) — roughly 24 GB total, downloaded once.
- **`anthropic`** (default for Codespaces) — cloud inference via the Anthropic API. Requires `ANTHROPIC_API_KEY`.

```bash
# Use Anthropic cloud inference locally
export ANTHROPIC_API_KEY=<your-api-key>
.semiont/scripts/start.sh --config anthropic --email admin@example.com --password password
```

```bash
# List available configs
.semiont/scripts/start.sh --list-configs
```

To create your own config, add a `.toml` file to `.semiont/containers/semiontconfig/`. See the [Configuration Guide](https://github.com/The-AI-Alliance/semiont/blob/main/docs/administration/CONFIGURATION.md) for the full reference.

## What's Inside

```
.devcontainer/                    # GitHub Codespaces configuration
.semiont/
├── config                        # Project name and settings
├── compose/                      # Docker Compose file for backend
├── containers/                   # Dockerfiles and inference configs
│   └── semiontconfig/            # Inference config variants (.toml)
└── scripts/                      # Backend startup script
```

As you work in the knowledge base, the backend writes event streams (annotations, links, generated content) as JSONL files into `.semiont/events/` and stages them with `git add`. The backend container includes its own Git installation for this purpose. You are responsible for committing and pushing these staged changes — treat the knowledge base like any other Git repository.

## Documentation

See the [Semiont repository](https://github.com/The-AI-Alliance/semiont) for full documentation:

- [Configuration Guide](https://github.com/The-AI-Alliance/semiont/blob/main/docs/administration/CONFIGURATION.md) — inference providers, vector search, graph database settings
- [Project Layout](https://github.com/The-AI-Alliance/semiont/blob/main/docs/PROJECT-LAYOUT.md) — how `.semiont/` and resource files are organized
- [Local Semiont](https://github.com/The-AI-Alliance/semiont/blob/main/docs/LOCAL-SEMIONT.md) — alternative setup paths including the Semiont CLI

## License

Apache 2.0 — See [LICENSE](LICENSE) for details.
