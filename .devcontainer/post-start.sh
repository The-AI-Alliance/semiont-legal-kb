#!/usr/bin/env bash
set -euo pipefail

# Runs on every Codespace start (creation and resume). Brings up the backend
# stack via backend.yml + the Codespace overrides + the observe profile.

cd "$(git rev-parse --show-toplevel)"

ENV_FILE=".devcontainer/.env"
ADMIN_FILE=".devcontainer/admin.json"
if [[ ! -f "$ENV_FILE" || ! -f "$ADMIN_FILE" ]]; then
  echo "ERROR: $ENV_FILE or $ADMIN_FILE missing — re-run .devcontainer/post-create.sh"
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
ADMIN_EMAIL=$(awk -F'"' '/"email"/{print $4}' "$ADMIN_FILE")
ADMIN_PASSWORD=$(awk -F'"' '/"password"/{print $4}' "$ADMIN_FILE")
set +a

print_banner() {
  cat <<EOF

──────────────────────────────────────────────────────────────────────
Semiont admin credentials (saved to $ADMIN_FILE)
──────────────────────────────────────────────────────────────────────
  email:    $ADMIN_EMAIL
  password: $ADMIN_PASSWORD
──────────────────────────────────────────────────────────────────────

EOF
}

# Print credentials up front so the user sees them even if compose fails.
print_banner

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  cat <<EOF
WARNING: ANTHROPIC_API_KEY is not set.
  Add it as a Codespaces user secret at:
    https://github.com/settings/codespaces
  Then rebuild the container (Codespaces: Rebuild Container).

EOF
fi

echo "Bringing up backend stack (compose up -d --wait, timeout 5 min)..."

COMPOSE_FILES=(--env-file "$ENV_FILE" \
  -f .semiont/compose/backend.yml \
  -f .devcontainer/docker-compose.codespaces.yml)

COMPOSE_OK=true
if ! docker compose "${COMPOSE_FILES[@]}" --profile observe up -d --wait --wait-timeout 300; then
  COMPOSE_OK=false
fi

# Best-effort embedding-model pull (idempotent, ignored on failure)
docker compose "${COMPOSE_FILES[@]}" exec -T ollama \
  ollama pull nomic-embed-text 2>/dev/null || true

if $COMPOSE_OK; then
  cat <<EOF

Semiont stack is up.
  Backend API    → port 4000  (forwarded by Codespaces)
  Jaeger UI      → port 16686
  Neo4j Browser  → port 7474   (login: neo4j / localpass)

EOF
  print_banner
  echo "Bring down with:  docker compose -f .semiont/compose/backend.yml --profile observe down"
else
  echo
  echo "ERROR: docker compose up did not bring all services healthy."
  echo
  echo "── service state ─────────────────────────────────────────────────"
  docker compose "${COMPOSE_FILES[@]}" ps || true
  for svc in backend worker smelter; do
    echo
    echo "── $svc (last 100 log lines) ────────────────────────────────────"
    docker compose "${COMPOSE_FILES[@]}" logs --tail=100 "$svc" 2>&1 || true
  done
  echo
  echo "Retry after fixing with:  bash .devcontainer/post-start.sh"
  print_banner
  exit 1
fi
