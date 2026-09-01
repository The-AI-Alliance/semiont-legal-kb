#!/usr/bin/env bash
set -euo pipefail

# Runs on every Codespace start (creation and resume). Brings up the stack
# via backend.yml + the Codespace overrides + the observe profile.

cd "$(git rev-parse --show-toplevel)"

ENV_FILE=".devcontainer/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE missing — re-run .devcontainer/post-create.sh"
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

# This repo's owner/name, for a copy-pasteable `semiont useradd --repo`.
# Codespaces exports GITHUB_REPOSITORY; the git remote is the fallback so the
# script is also correct when run by hand outside a Codespace.
REPO_SLUG="${GITHUB_REPOSITORY:-}"
if [[ -z "$REPO_SLUG" ]]; then
  REPO_SLUG=$(git remote get-url origin 2>/dev/null |
    sed -E 's#(git@[^:]+:|https://[^/]+/)##; s#\.git$##')
fi

print_useradd_hint() {
  cat <<EOF

──────────────────────────────────────────────────────────────────────
No user account exists yet — create the first admin
──────────────────────────────────────────────────────────────────────
  From your machine (with the Semiont launcher installed) — prompts for
  the password; no password is ever passed as an argument:

    semiont useradd --repo ${REPO_SLUG:-<owner>/<repo>} \\
      --email you@example.com --admin

  Or from a terminal in this Codespace (--generate-password prints a
  random one once; use --password-stdin to choose your own):

    docker compose -f .semiont/compose/backend.yml \\
      exec gateway semiont-useradd \\
      --email you@example.com --generate-password --admin
──────────────────────────────────────────────────────────────────────

EOF
}

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  cat <<EOF
WARNING: ANTHROPIC_API_KEY is not set.
  Add it as a Codespaces user secret at:
    https://github.com/settings/codespaces
  Then rebuild the container (Codespaces: Rebuild Container).

EOF
fi

echo "Bringing up the stack (compose up -d --wait, timeout 5 min)..."

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
  Semiont Browser → port 3000  (forwarded by Codespaces)
  Gateway API     → port 4000  (forwarded by Codespaces)
  Jaeger UI       → port 16686
  Neo4j Browser   → port 7474   (login: neo4j / localpass)

To use it from your machine, forward both ports:
  gh codespace ports forward 3000:3000 4000:4000
then open http://localhost:3000 and sign in as the admin you create below.

EOF
  print_useradd_hint
  echo "Bring down with:  docker compose -f .semiont/compose/backend.yml --profile observe down"
else
  echo
  echo "ERROR: docker compose up did not bring all services healthy."
  echo
  echo "── service state ─────────────────────────────────────────────────"
  docker compose "${COMPOSE_FILES[@]}" ps || true
  for svc in gateway worker smelter weaver browser; do
    echo
    echo "── $svc (last 100 log lines) ────────────────────────────────────"
    docker compose "${COMPOSE_FILES[@]}" logs --tail=100 "$svc" 2>&1 || true
  done
  echo
  echo "Retry after fixing with:  bash .devcontainer/post-start.sh"
  exit 1
fi
