#!/usr/bin/env bash
set -euo pipefail

# Runs on every Codespace start (creation and resume). Brings up the stack in
# .semiont/compose/backend.yml with the observe profile.

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
      --email you@example.com

  Or from a terminal in this Codespace (--generate-password prints a
  random one once; use --password-stdin to choose your own):

    semiont useradd --email you@example.com --generate-password
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

# ── Stage the configs the containers read ────────────────────────────────────
#
# Only the archivist mounts the knowledge base (SINGLE-KB-MOUNT), so the other
# services cannot read `.semiont/config` for themselves. The sidecars take its
# identity from a `[kb]` stanza appended to the environment TOML; the gateway
# reads no TOML at all, only its resolved JSON document. `semiont start` stages
# both; compose bind-mounts, so this script stages them instead.
#
# `.semiont/config` stays the single source of that identity — the domain is
# NOT duplicated into the semiontconfigs, which would be one fact in two files
# with nothing keeping them equal.
STAGED_CONFIG=".devcontainer/.staged-config.toml"
STAGED_GATEWAY=".devcontainer/.staged-gateway.json"
# Checksum before regenerating: compose recreates a container when its
# config DECLARATION changes, and the bind-mount path never does — only
# these bytes. Without an explicit recreate, a corrected config is written
# and then ignored by the containers already mounting it, which reads
# exactly like the fix not working.
staged_sum() { cat "$STAGED_CONFIG" "$STAGED_GATEWAY" | sha256sum | cut -d" " -f1; }
STAGED_PREV_SUM=""
if [[ -f "$STAGED_CONFIG" && -f "$STAGED_GATEWAY" ]]; then
  STAGED_PREV_SUM=$(staged_sum)
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

# Strip the surrounding quotes off a TOML string. Only for values this script
# uses as shell strings; the ones it re-emits into the staged config keep their
# source text verbatim, which is what toml_value is careful to preserve.
unquote() { local v=${1%\"}; echo "${v#\"}"; }

# The environment these sections live under — `[defaults] environment` in the
# selected config, which is what the containers load.
KB_ENV=$(unquote "$(toml_value defaults environment "$SOURCE_CONFIG")")
if [[ -z "$KB_ENV" ]]; then KB_ENV="local"; fi

KB_NAME=$(toml_value project name .semiont/config)
KB_DOMAIN=$(toml_value site domain .semiont/config)
KB_DOMAIN_BARE=$(unquote "$KB_DOMAIN")
if [[ -z "$KB_DOMAIN_BARE" ]]; then
  echo "ERROR: .semiont/config declares no [site] domain — the gateway's identity and the token audience derive from it."
  exit 1
fi

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
    # Declared-or-omitted, matching the launcher: a KB that declares no name
    # meets the librarian's refusal rather than inheriting a fabricated one.
    if [[ -n "$KB_NAME" ]]; then echo "name = $KB_NAME"; fi
    echo "domain = $KB_DOMAIN"
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
    echo "port = 24103"
  fi
} > "$STAGED_CONFIG"

echo "Staged $SOURCE_CONFIG + [kb] identity → $STAGED_CONFIG"

# Point compose at the staged copy. Relative to the compose file's own
# directory (.semiont/compose), which is how compose resolves these paths.
export SEMIONT_CONFIG="../../${STAGED_CONFIG}"

COMPOSE_FILES=(--env-file "$ENV_FILE" -f .semiont/compose/backend.yml)

# A setting of the selected environment, unquoted; "" names its own table.
env_setting() { unquote "$(toml_value "environments.${KB_ENV}${1:+.$1}" "$2" "$STAGED_CONFIG")"; }

# ── The gateway's resolved document ─────────────────────────────────────────
#
# What `semiont start` writes (gatewayDocument, apps/launcher gatewaydoc.go):
# the same inputs and the same absent-section rules. Every ${VAR} resolves
# against the environment compose declares for the gateway — a set variable
# wins even when empty, else the default, else a refusal. Written before the
# first command that mounts it: a missing bind source comes up as a directory.
docker compose "${COMPOSE_FILES[@]}" config --format json | jq \
  --arg config        "$SOURCE_CONFIG" \
  --arg name          "$(unquote "$KB_NAME")" \
  --arg domain        "$KB_DOMAIN_BARE" \
  --arg port          "$(env_setting gateway port)" \
  --arg publicUrl     "$(env_setting gateway publicURL)" \
  --arg issuer        "$(env_setting identity issuer)" \
  --arg subjectClaim  "$(env_setting identity subjectClaim)" \
  --arg archivistHost "$(env_setting archivist host)" \
  --arg archivistPort "$(env_setting archivist port)" \
  --arg signalType    "$(env_setting signal type)" \
  --arg servers       "$(env_setting signal servers)" \
  --arg user          "$(env_setting signal user)" \
  --arg password      "$(env_setting signal password)" \
  --arg logLevel      "$(env_setting "" logLevel)" \
  '.services.gateway.environment as $vars
  | (.services.gateway.mem_limit | tonumber) as $memory
  | def required($field):
      if . == "" then error("\($field) is not set in \($config)") else . end;
    def resolve($field):
      gsub("\\$\\{(?<ref>[^}]+)\\}";
        (.ref | index(":-")) as $i
        | (if $i then .ref[:$i] else .ref end) as $name
        | if $vars | has($name) then $vars[$name]
          elif $i then .ref[$i + 2:]
          else error("\($field) references ${\($name)}, which the gateway service does not set") end);
    # A credential is only ever named: the document carries no secret value.
    def secret_ref($key; $field):
      if . == "" then {}
      else {($key): ((capture("^\\$\\{(?<name>[A-Z_][A-Z0-9_]*)\\}$") | .name)
        // error("\($field) must be a ${VAR} reference — set the value in the environment"))} end;
    {
      kb: {name: $name, domain: $domain},
      port: ($port | required("gateway.port") | tonumber),
      publicUrl: (if $publicUrl == "" then "http://localhost:\($port)" else $publicUrl end
        | resolve("gateway.publicURL")),
      identity: {
        issuer: ($issuer | required("identity.issuer") | resolve("identity.issuer")),
        subjectClaim: $subjectClaim
      },
      archivist: {
        host: ($archivistHost | resolve("archivist.host")),
        port: ($archivistPort | required("archivist.port") | tonumber)
      },
      signal: (if $signalType == "nats"
        then {type: "nats", servers: ($servers | resolve("signal.servers"))}
          + ($user | secret_ref("userEnv"; "signal.user"))
          + ($password | secret_ref("passwordEnv"; "signal.password"))
        else {type: "in-process"} end),
      logLevel: (if $logLevel == "" then "info" else $logLevel end),
      logFormat: "json",
      # Half the container memory for queued stream bytes, the other half at
      # connectionAllowance (gatewaydoc.go: 20 KiB) per open connection.
      capacity: {queuedBytes: ($memory / 2 | floor), connections: ($memory / 2 / 20480 | floor)}
    }' > "$STAGED_GATEWAY"

echo "Staged the gateway's resolved document → $STAGED_GATEWAY"

# ── Make the shared state volume writable by the container user ─────────────
#
# The archivist writes its projections to one state volume (XDG_STATE_HOME)
# and the librarian reads them there; the gateway's supervisor keeps its
# events log there too.
#
# The images run as `semiont` (uid 1001) and pre-create `/kb`, but not
# `/semiont-state`. Docker seeds a fresh named volume from the image at that
# path — and when the image has nothing there, the volume is created
# root-owned, so uid 1001 cannot write the projections. `semiont start` never
# hits this: it bind-mounts a host directory it created itself.
#
# One root-run chown fixes the volume for good; it is idempotent, and cheap
# once the volume already has the right owner. --no-deps keeps it from
# starting the stack, and `run` publishes no ports.
echo "Ensuring the shared state volume is writable by uid 1001..."
docker compose "${COMPOSE_FILES[@]}" run --rm --no-deps --user root \
  --entrypoint sh gateway -c \
  'mkdir -p /semiont-state && chown -R 1001:1001 /semiont-state' >/dev/null

# Pull the embedding model BEFORE the stack: archivist, librarian and smelter
# create vector collections on boot and exit(1) without it — and while the
# archivist flaps, compose abandons `worker` (its only service_healthy
# dependent) in `Created`, where no restart policy reaches it.
#
# The model name comes from [environments.<env>.embedding]; a copy here would
# be one fact in two files.
EMBED_TYPE=$(env_setting embedding type)
EMBED_MODEL=$(env_setting embedding model)

if [[ "$EMBED_TYPE" == "ollama" ]]; then
  if [[ -z "$EMBED_MODEL" ]]; then
    echo "ERROR: [environments.${KB_ENV}.embedding] sets type = \"ollama\" but declares no model."
    exit 1
  fi
  # Generous: usually instant (post-create.sh already pulled), but this may
  # carry the 3.7 GB ollama image if that pull did not land.
  echo "Starting ollama and pulling the embedding model '$EMBED_MODEL'..."
  docker compose "${COMPOSE_FILES[@]}" up -d --wait --wait-timeout 600 ollama
  if ! docker compose "${COMPOSE_FILES[@]}" exec -T ollama ollama pull "$EMBED_MODEL"; then
    echo
    echo "ERROR: could not pull the embedding model '$EMBED_MODEL'."
    echo "  The archivist, librarian and smelter cannot create their vector"
    echo "  collections without it, and 'worker' would not start at all."
    echo "  Retry with:  bash .devcontainer/post-start.sh"
    exit 1
  fi
fi

# ── Identity: import the realm, then let the launcher fill it in ───────────
#
# The committed realm carries realm settings and the two PUBLIC clients only,
# which `semiont identity sync` will not invent. Sync creates the seven
# service-account clients itself, each with the secret post-create.sh wrote to
# .env — an exported value wins over one it would generate.
#
# The audience must equal the gateway's own byte-for-byte: "https://" + the
# committed domain with every ":" replaced by "/".
sed "s|__SEMIONT_AUDIENCE__|https://${KB_DOMAIN_BARE//:/\/}|g" \
  .semiont/compose/keycloak-realm.json > .devcontainer/.staged-realm.json

echo "Starting Keycloak..."
docker compose "${COMPOSE_FILES[@]}" up -d --wait --wait-timeout 300 keycloak

# Compose's gate is port-open, which Keycloak passes before the import lands.
for i in $(seq 1 60); do
  curl -fsS http://localhost:8080/realms/semiont/.well-known/openid-configuration >/dev/null 2>&1 && break
  if [[ $i -eq 60 ]]; then
    echo "ERROR: realm 'semiont' never answered on :8080 — see: docker compose logs keycloak"
    exit 1
  fi
  sleep 2
done

semiont identity sync --config "$(basename "$SOURCE_CONFIG_REL" .toml)"

# Services that mount a staged config. The browser has no config mount, and
# the infra services are not ours to churn, so neither is listed.
STAGED_CONSUMERS=(gateway archivist dispatcher librarian worker smelter weaver)

if [[ -n "$STAGED_PREV_SUM" ]] && [[ "$STAGED_PREV_SUM" != "$(staged_sum)" ]]; then
  echo "Staged configs changed — recreating the services that mount them..."
  docker compose "${COMPOSE_FILES[@]}" up -d --no-deps --force-recreate "${STAGED_CONSUMERS[@]}"
fi

echo "Bringing up the stack (compose up -d --wait, timeout 5 min)..."

COMPOSE_OK=true
if ! docker compose "${COMPOSE_FILES[@]}" --profile observe up -d --wait --wait-timeout 300; then
  COMPOSE_OK=false
fi

if $COMPOSE_OK; then
  cat <<EOF

Semiont stack is up.
  Semiont Browser → port 3000  (forwarded by Codespaces)
  Gateway API     → port 4000  (forwarded by Codespaces)
  Keycloak        → port 8080  (sign-in; the browser is sent to keycloak.localhost:8080)
  Jaeger UI       → port 16686  (traces)
  Prometheus      → port 9090   (metrics; scrapes the collector)
  Collector       → port 24110  (raw /metrics readout)
  Neo4j Browser   → port 7474   (login: neo4j / localpass)

To use it from your machine, forward all three ports:
  gh codespace ports forward 3000:3000 4000:4000 8080:8080
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
  for svc in gateway archivist librarian worker smelter weaver browser; do
    echo
    echo "── $svc (last 100 log lines) ────────────────────────────────────"
    docker compose "${COMPOSE_FILES[@]}" logs --tail=100 "$svc" 2>&1 || true
  done
  echo
  echo "Retry after fixing with:  bash .devcontainer/post-start.sh"
  exit 1
fi
