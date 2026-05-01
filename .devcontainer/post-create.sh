#!/usr/bin/env bash
set -euo pipefail

# Runs once on Codespace creation. Generates the per-codespace worker secret
# and warms the third-party image cache. The Semiont images (backend, worker,
# smelter) are built on first `docker compose up`.

cd "$(git rev-parse --show-toplevel)"

ENV_FILE=".devcontainer/.env"
if [[ ! -f "$ENV_FILE" ]] || ! grep -q '^SEMIONT_WORKER_SECRET=' "$ENV_FILE"; then
  echo "SEMIONT_WORKER_SECRET=$(openssl rand -hex 32)" > "$ENV_FILE"
  echo "Generated SEMIONT_WORKER_SECRET → $ENV_FILE"
fi

ADMIN_FILE=".devcontainer/admin.json"
if [[ ! -f "$ADMIN_FILE" ]]; then
  email="admin-$(openssl rand -hex 4)@semiont.local"
  password="$(openssl rand -hex 16)"
  cat > "$ADMIN_FILE" <<EOF
{
  "email": "$email",
  "password": "$password"
}
EOF
  echo "Generated admin credentials → $ADMIN_FILE"
fi

COMPOSE_BASE=(--env-file "$ENV_FILE" \
  -f .semiont/compose/backend.yml \
  -f .devcontainer/docker-compose.codespaces.yml)

# Pull third-party images (neo4j, qdrant, postgres, ollama, jaeger).
docker compose "${COMPOSE_BASE[@]}" --profile observe pull

# Build the three Semiont images now (rather than on first `up`) so the user
# sees a ready stack on first shell.
docker compose "${COMPOSE_BASE[@]}" build

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
