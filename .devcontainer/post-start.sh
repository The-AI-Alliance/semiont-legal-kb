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
# Checksum before regenerating: compose recreates a container when its
# config DECLARATION changes, and the bind-mount path never does — only
# these bytes. Without an explicit recreate, a corrected config is written
# and then ignored by the containers already mounting it, which reads
# exactly like the fix not working.
STAGED_PREV_SUM=""
if [[ -f "$STAGED_CONFIG" ]]; then
  STAGED_PREV_SUM=$(sha256sum "$STAGED_CONFIG" | cut -d" " -f1)
fi
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

# The environment these sections live under — `[defaults] environment` in the
# selected config, which is what the containers load.
KB_ENV_RAW=$(toml_value defaults environment "$SOURCE_CONFIG")
KB_ENV=${KB_ENV_RAW%\"}
KB_ENV=${KB_ENV#\"}
if [[ -z "$KB_ENV" ]]; then KB_ENV="local"; fi

KB_NAME=$(toml_value project name .semiont/config)
KB_DOMAIN=$(toml_value site domain .semiont/config)
KB_OAUTH=$(toml_value site oauthAllowedDomains .semiont/config)

{
  cat "$SOURCE_CONFIG"
  echo ""
  echo "# Staged by post-start.sh — this KB's committed identity, copied from"
  echo "# .semiont/config. Regenerated on every start: edit .semiont/config,"
  echo "# never this file."
  # Operator-wins, same as the launcher: a config that already declares [kb]
  # keeps it. Appending a second one would be a duplicate TOML table — a parse
  # error, not an override.
  if ! grep -q "^\[kb\]" "$SOURCE_CONFIG"; then
    echo "[kb]"
    # Declared-or-omitted, matching the launcher: a KB that declares no domain
    # or no sign-in policy still meets the gateway's refusal rather than
    # inheriting a fabricated one.
    if [[ -n "$KB_NAME" ]];   then echo "name = $KB_NAME"; fi
    if [[ -n "$KB_DOMAIN" ]]; then echo "domain = $KB_DOMAIN"; fi
    if [[ -n "$KB_OAUTH" ]];  then echo "oauthAllowedDomains = $KB_OAUTH"; fi
  fi

  # Where THIS stack's archivist listens. gateway, worker, smelter and the
  # librarian all dial it for the record, and the config loader refuses to
  # start without it ("services.archivist.host is not configured"). `semiont
  # start` appends the same section per staged copy; under compose the service
  # name IS the hostname, so one literal serves every consumer.
  #
  # A hand-written section wins: an operator describing a topology this script
  # cannot see (a remote archivist, a split deployment) outranks the default.
  if ! grep -q "^\[environments\.${KB_ENV}\.archivist\]" "$SOURCE_CONFIG"; then
    echo ""
    echo "[environments.${KB_ENV}.archivist]"
    echo "host = \"archivist\""
    echo "port = 9093"
  fi
} > "$STAGED_CONFIG"

echo "Staged $SOURCE_CONFIG + [kb] identity → $STAGED_CONFIG"

# Point compose at the staged copy. Relative to the compose file's own
# directory (.semiont/compose), which is how compose resolves these paths.
export SEMIONT_CONFIG="../../${STAGED_CONFIG}"

COMPOSE_FILES=(--env-file "$ENV_FILE" \
  -f .semiont/compose/backend.yml \
  -f .devcontainer/docker-compose.codespaces.yml)

# ── Make the shared state volume writable by the container user ─────────────
#
# gateway, archivist and librarian share one state volume: the job queue is
# filesystem-backed, so all three must read and write the same directory.
#
# The images run as `semiont` (uid 1001) and pre-create `/kb`, but not
# `/semiont-state`. Docker seeds a fresh named volume from the image at that
# path — and when the image has nothing there, the volume is created
# root-owned, so uid 1001 cannot mkdir inside it and the gateway dies with
# EACCES before it can serve anything. `semiont start` never hits this: it
# bind-mounts a host directory it created itself.
#
# One root-run chown fixes the volume for good; it is idempotent, and cheap
# once the volume already has the right owner. --no-deps keeps it from
# starting the stack, and `run` publishes no ports.
echo "Ensuring the shared state volume is writable by uid 1001..."
docker compose "${COMPOSE_FILES[@]}" run --rm --no-deps --user root \
  --entrypoint sh gateway -c \
  'mkdir -p /semiont-state && chown -R 1001:1001 /semiont-state' >/dev/null

# Services that mount the staged config. The browser has no config mount, and
# the infra services are not ours to churn, so neither is listed.
STAGED_CONSUMERS=(gateway archivist librarian worker smelter weaver)

if [[ -n "$STAGED_PREV_SUM" ]] && [[ "$STAGED_PREV_SUM" != "$(sha256sum "$STAGED_CONFIG" | cut -d" " -f1)" ]]; then
  echo "Staged config changed — recreating the services that mount it..."
  docker compose "${COMPOSE_FILES[@]}" up -d --no-deps --force-recreate "${STAGED_CONSUMERS[@]}"
fi

echo "Bringing up the stack (compose up -d --wait, timeout 5 min)..."

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
