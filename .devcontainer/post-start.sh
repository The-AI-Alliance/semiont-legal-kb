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

# ── Stage the KB's committed identity into the config the containers read ────
#
# The gateway no longer mounts the knowledge base (SINGLE-KB-MOUNT), so it
# cannot read `.semiont/config` for itself. It needs the identity to arrive in
# the environment config: either a `[site]` section or a `[kb]` stanza. On the
# local path `semiont start` appends that stanza when it stages a per-service
# copy; compose bind-mounts the committed TOML straight through, so without
# this step the gateway refuses to boot on a missing `site.domain`.
#
# `.semiont/config` stays the single source of that identity — the domain is
# NOT duplicated into the semiontconfigs, which would be one fact in two files
# with nothing keeping them equal.
STAGED_CONFIG=".devcontainer/.staged-config.toml"
SOURCE_CONFIG_REL="${SEMIONT_CONFIG:-../semiontconfig/ollama-gemma.toml}"
SOURCE_CONFIG=".semiont/compose/${SOURCE_CONFIG_REL}"

if [[ ! -f "$SOURCE_CONFIG" ]]; then
  echo "ERROR: config not found: $SOURCE_CONFIG (SEMIONT_CONFIG=$SOURCE_CONFIG_REL)"
  exit 1
fi

# The raw right-hand side, verbatim — re-emitting the source text avoids
# re-quoting a string or an array and getting either subtly wrong.
toml_value() {
  awk -v sec="[$1]" -v key="$2" '
    $0 == sec { in_section = 1; next }
    /^\[/    { in_section = 0 }
    in_section && $0 ~ "^" key "[[:space:]]*=" {
      sub("^" key "[[:space:]]*=[[:space:]]*", "")
      print
      exit
    }' "$3"
}

KB_NAME=$(toml_value project name .semiont/config)
KB_DOMAIN=$(toml_value site domain .semiont/config)
KB_OAUTH=$(toml_value site oauthAllowedDomains .semiont/config)

{
  cat "$SOURCE_CONFIG"
  echo ""
  echo "# Staged by post-start.sh — this KB's committed identity, copied from"
  echo "# .semiont/config. Regenerated on every start: edit .semiont/config,"
  echo "# never this file."
  echo "[kb]"
  # Declared-or-omitted, matching the launcher: a KB that declares no domain
  # or no sign-in policy still meets the gateway's refusal rather than
  # inheriting a fabricated one.
  if [[ -n "$KB_NAME" ]];   then echo "name = $KB_NAME"; fi
  if [[ -n "$KB_DOMAIN" ]]; then echo "domain = $KB_DOMAIN"; fi
  if [[ -n "$KB_OAUTH" ]];  then echo "oauthAllowedDomains = $KB_OAUTH"; fi
} > "$STAGED_CONFIG"

echo "Staged $SOURCE_CONFIG + [kb] identity → $STAGED_CONFIG"

# Point compose at the staged copy. Relative to the compose file's own
# directory (.semiont/compose), which is how compose resolves these paths.
export SEMIONT_CONFIG="../../${STAGED_CONFIG}"

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
