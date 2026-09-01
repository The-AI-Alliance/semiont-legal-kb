#!/usr/bin/env bash
set -euo pipefail

# Runs once on Codespace creation. Generates the per-codespace secrets and
# warms the image cache. All images are published (ghcr.io) — nothing is
# built here, and no user account is created (see post-start.sh's closing
# instructions: `semiont useradd` makes the first admin).

cd "$(git rev-parse --show-toplevel)"

ENV_FILE=".devcontainer/.env"
touch "$ENV_FILE"

# Per-codespace secrets, generated once and KEPT.
#
# Each is added independently and APPENDED — an earlier version wrote with `>`,
# which was safe with one secret and would silently erase the other now that
# there are two.
#
# Never regenerate one that already exists: rotating JWT_SECRET invalidates
# every token the KB has issued, which strands logged-in clients and leaves
# in-flight jobs waiting on replies they can no longer authenticate.
#
# The local path does not come through here — `semiont start` generates and
# injects JWT_SECRET per KB root. This is the codespace equivalent, and it was
# missing: the gateway requires the secret and crash-looped without it.
ensure_secret() {
  local name="$1"
  if ! grep -q "^${name}=" "$ENV_FILE"; then
    echo "${name}=$(openssl rand -hex 32)" >> "$ENV_FILE"
    echo "Generated ${name} → $ENV_FILE"
  fi
}
ensure_secret SEMIONT_WORKER_SECRET
ensure_secret JWT_SECRET

COMPOSE_BASE=(--env-file "$ENV_FILE" \
  -f .semiont/compose/backend.yml \
  -f .devcontainer/docker-compose.codespaces.yml)

# Pull all images — the five published Semiont images plus the infra
# (neo4j, qdrant, postgres, ollama, jaeger).
docker compose "${COMPOSE_BASE[@]}" --profile observe pull

# Make .devcontainer/.env auto-sourced in interactive shells so the user can
# run `docker compose …` without compose blowing up on missing variables.
ENV_FILE_ABS="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
SOURCE_LINE="[ -f \"$ENV_FILE_ABS\" ] && set -a && . \"$ENV_FILE_ABS\" && set +a"
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [[ -f "$rc" ]] && ! grep -qF "$ENV_FILE_ABS" "$rc"; then
    {
      echo ""
      echo "# semiont-template-kb: source per-codespace env"
      echo "$SOURCE_LINE"
    } >> "$rc"
  fi
done
