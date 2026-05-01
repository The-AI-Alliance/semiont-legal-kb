#!/usr/bin/env bash
set -euo pipefail

# Start a local Semiont backend with all services in containers.

echo -e "\033[2m[$(date '+%Y-%m-%d %H:%M:%S')] start.sh started\033[0m"

cd "$(git rev-parse --show-toplevel)"

# --- Colors & output helpers ---

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

QUIET=false

log()     { $QUIET || echo -e "${CYAN}▸${RESET} $1"; }
ok()      { $QUIET || echo -e "${GREEN}✓${RESET} $1"; }
warn()    { echo -e "${YELLOW}⚠️${RESET}  $1"; }
fail()    { echo -e "${RED}✗${RESET} $1" >&2; }
banner()  { $QUIET || echo -e "\n${BOLD}$1${RESET}"; }
run_cmd() { $QUIET || echo -e "  ${DIM}\$ $*${RESET}"; "$@"; }

# Wait for an HTTP endpoint to return 2xx. Fail the script on timeout.
wait_for_http() {
  local name=$1 url=$2 tries=${3:-30}
  for _ in $(seq 1 "$tries"); do
    if curl -sf "$url" > /dev/null 2>&1; then return 0; fi
    sleep 1
  done
  fail "$name did not become ready at $url within ${tries}s."
  exit 1
}

# Wait for Postgres to accept connections via pg_isready.
wait_for_pg() {
  local host=$1 port=$2 tries=${3:-30}
  for _ in $(seq 1 "$tries"); do
    if "$RT" run --rm postgres:15-alpine pg_isready -h "$host" -p "$port" > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "PostgreSQL did not become ready on $host:$port within ${tries}s."
  exit 1
}

# Fail if a TCP port is already in use, naming the offending process. With
# FORCE_KILL_PORTS=true, kill the holder and verify the port is free instead.
require_port_free() {
  local port=$1 service=$2 pid proc
  pid=$(lsof -ti ":$port" 2>/dev/null || echo "")
  if [[ -z "$pid" ]]; then return 0; fi
  proc=$(ps -p "$pid" -o comm= 2>/dev/null || echo "<unknown>")
  if $FORCE_KILL_PORTS; then
    warn "Port $port (needed for $service) held by PID $pid ($proc) — killing (--force-kill-ports)."
    kill "$pid" 2>/dev/null || true
    sleep 1
    pid=$(lsof -ti ":$port" 2>/dev/null || echo "")
    if [[ -n "$pid" ]]; then
      fail "Port $port still held after kill (PID $pid)."
      exit 1
    fi
    return 0
  fi
  fail "Port $port (needed for $service) is held by PID $pid ($proc)."
  echo "  Stop the conflicting process and re-run, or pass --force-kill-ports." >&2
  exit 1
}

# List running containers — runtime-portable.
list_containers() {
  case "$RT" in
    container) "$RT" list 2>/dev/null ;;
    *) "$RT" ps 2>/dev/null ;;
  esac
}

# --- Parse arguments ---

CONFIG_NAME="ollama-gemma"
CONFIG_DIR=".semiont/containers/semiontconfig"
CACHE_FLAG=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
CLEAN_OLLAMA=false
LIST_CONFIGS=false
FORCE_KILL_PORTS=false
OBSERVE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_NAME="$2"; shift 2 ;;
    --list-configs) LIST_CONFIGS=true; shift ;;
    --no-cache) CACHE_FLAG="--no-cache"; shift ;;
    --email) ADMIN_EMAIL="$2"; shift 2 ;;
    --password) ADMIN_PASSWORD="$2"; shift 2 ;;
    --clean-ollama) CLEAN_OLLAMA=true; shift ;;
    --force-kill-ports) FORCE_KILL_PORTS=true; shift ;;
    --observe) OBSERVE=true; shift ;;
    --quiet|-q) QUIET=true; shift ;;
    --help|-h)
      echo "Usage: start.sh [options]"
      echo ""
      echo "Start a local Semiont backend with Neo4j, Qdrant, Ollama, PostgreSQL,"
      echo "and the Semiont API server — all in containers."
      echo ""
      echo "Options:"
      echo "  --config <name>       Semiontconfig to use (default: ollama-gemma)"
      echo "  --list-configs        List available configs and exit"
      echo "  --no-cache            Force a fresh backend container build"
      echo "  --email <email>       Admin user email (requires --password)"
      echo "  --password <pass>     Admin user password (requires --email)"
      echo "  --clean-ollama        Remove the Ollama model cache volume and exit"
      echo "  --force-kill-ports    Kill any non-Semiont process holding a needed port"
      echo "  --observe             Run a Jaeger sidecar and export OTel traces + metrics to it"
      echo "  --quiet, -q           Suppress informational output"
      echo "  --help, -h            Show this help"
      echo ""
      echo "Examples:"
      echo "  # Fully local with Ollama (default, no API key needed)"
      echo "  start.sh --email admin@example.com --password password"
      echo ""
      echo "  # Anthropic cloud inference"
      echo "  export ANTHROPIC_API_KEY=<your-key>"
      echo "  start.sh --config anthropic --email admin@example.com --password password"
      echo ""
      echo "  # See available configs"
      echo "  start.sh --list-configs"
      exit 0
      ;;
    *) fail "Unknown argument: $1"; exit 1 ;;
  esac
done

# --- Validate admin credentials ---

if [[ -n "$ADMIN_EMAIL" || -n "$ADMIN_PASSWORD" ]]; then
  if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
    fail "--email and --password must be provided together."
    exit 1
  fi
  if [[ ! "$ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
    fail "Invalid --email: '$ADMIN_EMAIL'"
    exit 1
  fi
  if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
    fail "--password must be at least 8 characters."
    exit 1
  fi
fi

# --- List or validate config ---

if [[ "${LIST_CONFIGS}" == "true" ]]; then
  echo "Available configs:"
  for f in "${CONFIG_DIR}"/*.toml; do
    echo "  $(basename "${f}" .toml)"
  done
  exit 0
fi

CONFIG_FILE="${CONFIG_DIR}/${CONFIG_NAME}.toml"
if [[ ! -f "${CONFIG_FILE}" ]]; then
  fail "Config not found: ${CONFIG_FILE}"
  echo "Available configs:"
  for f in "${CONFIG_DIR}"/*.toml; do
    echo "  $(basename "${f}" .toml)"
  done
  exit 1
fi

# --- Detect container runtime ---

for rt in container docker podman; do
  if command -v "$rt" > /dev/null 2>&1; then
    RT="$rt"
    break
  fi
done
if [[ -z "${RT:-}" ]]; then
  fail "No container runtime found. Install Apple Container, Docker, or Podman."
  exit 1
fi

# Handle --clean-ollama
if [[ "${CLEAN_OLLAMA}" == "true" ]]; then
  log "Removing Ollama model cache volume..."
  if run_cmd "${RT}" volume rm semiont-ollama-models 2>/dev/null; then
    ok "Removed."
  else
    warn "Volume not found."
  fi
  exit 0
fi

NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"

banner "Semiont Local Backend"
log "Container runtime: ${BOLD}${RT}${RESET}"
log "Config: ${BOLD}${CONFIG_NAME}${RESET}"
log "npm registry: ${DIM}${NPM_REGISTRY}${RESET}"

# --- Resolve required env vars from config ---
#
# Config TOMLs reference env vars as ${VAR} (required) or ${VAR:-default}
# (optional). We extract the required forms and validate them — except the
# ones this script injects itself.

INJECTED_VARS=" BACKEND_HOST NEO4J_HOST QDRANT_HOST OLLAMA_HOST POSTGRES_HOST SEMIONT_WORKER_SECRET ADMIN_EMAIL ADMIN_PASSWORD "

config_required_vars() {
  grep -oE '\$\{[A-Z_][A-Z0-9_]*\}' "$CONFIG_FILE" | sed 's/[${}]//g' | sort -u
}

USER_ENV_ARGS=()
for var in $(config_required_vars); do
  if [[ "$INJECTED_VARS" == *" $var "* ]]; then
    continue
  fi
  if [[ -z "${!var:-}" ]]; then
    fail "Config '${CONFIG_NAME}' references \${$var} but it is not set in the environment."
    exit 1
  fi
  USER_ENV_ARGS+=(--env "$var=${!var}")
done

# --- Resolve host address for container networking ---

HOST_ADDR=$("$RT" run --rm node:22-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')
if [[ -z "$HOST_ADDR" ]]; then
  fail "Could not determine host address for container networking."
  echo "  The default-gateway probe (alpine container) returned no result." >&2
  exit 1
fi
log "Host address: ${DIM}${HOST_ADDR}${RESET}"

# --- Preflight: stop prior Semiont containers, verify required ports are free ---
#
# We do this up front (rather than per-service) so a port conflict surfaces
# before any image work happens. Ollama (11434) is checked later because we
# only need its port if no host Ollama is already serving it.

banner "Preflight"

# `stop` only halts a running container; under Apple Container the stopped
# instance persists and the next `run --name <c>` fails with "already exists".
# `rm` after `stop` (both with `|| true`) makes the loop idempotent across
# all three states the container could be in: not present, running, or
# stopped-but-not-removed.
for c in semiont-jaeger semiont-neo4j semiont-qdrant semiont-postgres semiont-backend semiont-worker semiont-smelter; do
  run_cmd "$RT" stop "$c" 2>/dev/null || true
  run_cmd "$RT" rm "$c" 2>/dev/null || true
done
sleep 1

require_port_free 7474 "Neo4j HTTP"
require_port_free 7687 "Neo4j Bolt"
require_port_free 6333 "Qdrant"
require_port_free 5432 "PostgreSQL"
require_port_free 4000 "Backend"
require_port_free 9090 "Worker"
require_port_free 9091 "Smelter"
if $OBSERVE; then
  require_port_free 16686 "Jaeger UI"
  require_port_free 4318 "Jaeger OTLP"
fi
ok "Required ports are free"

# --- Jaeger (observability) ---
#
# When --observe is set, run jaegertracing/all-in-one and configure the
# Semiont processes to push OTLP traces + metrics there. The doc's Tier 3
# metrics export over the same endpoint, so one env var covers both.

OTEL_ARGS=()
if $OBSERVE; then
  banner "Jaeger"
  run_cmd "$RT" run -d --rm \
    --name semiont-jaeger \
    -p 16686:16686 \
    -p 4318:4318 \
    jaegertracing/all-in-one:latest > /dev/null
  wait_for_http "Jaeger UI" http://localhost:16686 30
  ok "Jaeger UI on http://localhost:16686 (OTLP collector: ${HOST_ADDR}:4318)"
  OTEL_ARGS=(--env OTEL_EXPORTER_OTLP_ENDPOINT="http://${HOST_ADDR}:4318")
fi

# --- Neo4j ---

NEO4J_NAME="semiont-neo4j"
banner "Neo4j"

run_cmd "$RT" run -d --rm \
  --name "$NEO4J_NAME" \
  -p 7474:7474 \
  -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/localpass \
  -e NEO4J_ACCEPT_LICENSE_AGREEMENT=yes \
  neo4j:5-community > /dev/null

wait_for_http Neo4j http://localhost:7474 30
ok "Neo4j on bolt://localhost:7687 (browser: http://localhost:7474)"

# --- Qdrant ---

QDRANT_NAME="semiont-qdrant"
banner "Qdrant"

run_cmd "$RT" run -d --rm \
  --name "$QDRANT_NAME" \
  -p 6333:6333 \
  qdrant/qdrant > /dev/null

wait_for_http Qdrant http://localhost:6333/readyz 15
ok "Qdrant on http://localhost:6333"

# --- Ollama ---

OLLAMA_NAME="semiont-ollama"
banner "Ollama"

if curl -sf http://localhost:11434/api/version > /dev/null 2>&1; then
  # Host Ollama detected — verify it's reachable from containers
  if "${RT}" run --rm node:22-alpine sh -c "wget -q -O- http://${HOST_ADDR}:11434/api/version" > /dev/null 2>&1; then
    ok "Using host Ollama at http://localhost:11434"
  else
    echo ""
    warn "Ollama is running on the host but not reachable from containers."
    echo "   The backend runs in a container and needs Ollama at ${HOST_ADDR}:11434."
    echo ""
    if pgrep -f 'Ollama.app/Contents' > /dev/null 2>&1; then
      echo "   Detected: Ollama Desktop app"
    elif pgrep -f 'ollama serve' > /dev/null 2>&1; then
      echo "   Detected: ollama serve daemon"
    fi
    echo ""
    echo "   Fix: configure Ollama to listen on all interfaces:"
    echo -e "     ${BOLD}launchctl setenv OLLAMA_HOST 0.0.0.0${RESET}"
    echo "   Then fully quit Ollama Desktop from the menu bar and relaunch it."
    echo ""
    echo "   (If launchctl doesn't stick, quit Ollama Desktop entirely and run"
    echo -e "    ${BOLD}OLLAMA_HOST=0.0.0.0:11434 ollama serve${RESET} from a terminal.)"
    echo ""
    exit 1
  fi
else
  log "No host Ollama detected — starting container..."
  run_cmd "${RT}" stop "${OLLAMA_NAME}" 2>/dev/null || true
  sleep 1
  require_port_free 11434 "Ollama"

  OLLAMA_VOLUME=""
  if [ -d "${HOME}/.ollama" ]; then
    printf "  Found local Ollama model cache at %s. Share it? [Y/n] (auto-yes in 10s) " "${HOME}/.ollama"
    read -r -t 10 answer || answer=""
    if [ "${answer}" != "n" ] && [ "${answer}" != "N" ]; then
      OLLAMA_VOLUME="${HOME}/.ollama:/root/.ollama"
      log "Using host model cache."
    fi
  fi
  if [ -z "${OLLAMA_VOLUME}" ]; then
    OLLAMA_VOLUME="semiont-ollama-models:/root/.ollama"
    log "Using named volume semiont-ollama-models for model cache."
  fi

  run_cmd "${RT}" run -d --rm \
    --name "${OLLAMA_NAME}" \
    -p 11434:11434 \
    -m 24G \
    -v "${OLLAMA_VOLUME}" \
    ollama/ollama > /dev/null

  wait_for_http Ollama http://localhost:11434/api/version 30
  ok "Ollama container on http://localhost:11434 (24 GB memory)"
fi

# --- PostgreSQL ---

POSTGRES_NAME="semiont-postgres"
banner "PostgreSQL"

run_cmd "$RT" run -d --rm \
  --name "$POSTGRES_NAME" \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=localpass \
  -e POSTGRES_DB=semiont \
  postgres:15-alpine > /dev/null

wait_for_pg "$HOST_ADDR" 5432 20
ok "PostgreSQL on port 5432"

# --- Generate worker secret ---

SEMIONT_WORKER_SECRET="${SEMIONT_WORKER_SECRET:-$(openssl rand -hex 32)}"
log "Worker secret: ${DIM}(generated)${RESET}"

# --- Build images ---

banner "Building Images"

log "Building backend image..."
run_cmd "$RT" build $CACHE_FLAG --tag semiont-backend \
  --build-arg NPM_REGISTRY="$NPM_REGISTRY" \
  --build-arg SEMIONT_CONFIG="$CONFIG_FILE" \
  --file .semiont/containers/Dockerfile.backend .
ok "Backend image built"

log "Building worker image..."
run_cmd "$RT" build $CACHE_FLAG --tag semiont-worker \
  --build-arg NPM_REGISTRY="$NPM_REGISTRY" \
  --build-arg SEMIONT_CONFIG="$CONFIG_FILE" \
  --file .semiont/containers/Dockerfile.worker .
ok "Worker image built"

log "Building smelter image..."
run_cmd "$RT" build $CACHE_FLAG --tag semiont-smelter \
  --build-arg NPM_REGISTRY="$NPM_REGISTRY" \
  --build-arg SEMIONT_CONFIG="$CONFIG_FILE" \
  --file .semiont/containers/Dockerfile.smelter .
ok "Smelter image built"

# --- Run backend ---

banner "Starting Backend"
log "http://localhost:4000"

ADMIN_ARGS=()
if [[ -n "$ADMIN_EMAIL" && -n "$ADMIN_PASSWORD" ]]; then
  ADMIN_ARGS=(--env ADMIN_EMAIL="$ADMIN_EMAIL" --env ADMIN_PASSWORD="$ADMIN_PASSWORD")
  log "Admin user: ${BOLD}${ADMIN_EMAIL}${RESET}"
fi

run_cmd "$RT" run -d --rm \
  --name semiont-backend \
  --publish 4000:4000 \
  --memory 8G \
  --volume "$(pwd)":/kb \
  ${USER_ENV_ARGS[@]+"${USER_ENV_ARGS[@]}"} \
  ${OTEL_ARGS[@]+"${OTEL_ARGS[@]}"} \
  --env POSTGRES_HOST="$HOST_ADDR" \
  --env NEO4J_HOST="$HOST_ADDR" \
  --env QDRANT_HOST="${HOST_ADDR}" \
  --env OLLAMA_HOST="${HOST_ADDR}" \
  --env SEMIONT_WORKER_SECRET="${SEMIONT_WORKER_SECRET}" \
  ${ADMIN_ARGS[@]+"${ADMIN_ARGS[@]}"} \
  semiont-backend > /dev/null

log "Waiting for backend health..."
wait_for_http Backend http://localhost:4000/api/health 120
ok "Backend healthy"

# --- Run worker pool ---

banner "Starting Worker Pool"

run_cmd "$RT" run -d --rm \
  --name semiont-worker \
  --memory 8G \
  --publish 9090:9090 \
  ${USER_ENV_ARGS[@]+"${USER_ENV_ARGS[@]}"} \
  ${OTEL_ARGS[@]+"${OTEL_ARGS[@]}"} \
  --env BACKEND_HOST="${HOST_ADDR}" \
  --env OLLAMA_HOST="${HOST_ADDR}" \
  --env NEO4J_HOST="${HOST_ADDR}" \
  --env QDRANT_HOST="${HOST_ADDR}" \
  --env POSTGRES_HOST="${HOST_ADDR}" \
  --env SEMIONT_WORKER_SECRET="${SEMIONT_WORKER_SECRET}" \
  semiont-worker > /dev/null

wait_for_http Worker http://localhost:9090/health 30
ok "Worker pool healthy (http://localhost:9090)"

# --- Run smelter ---

banner "Starting Smelter"

run_cmd "$RT" run -d --rm \
  --name semiont-smelter \
  --memory 4G \
  --publish 9091:9091 \
  ${USER_ENV_ARGS[@]+"${USER_ENV_ARGS[@]}"} \
  ${OTEL_ARGS[@]+"${OTEL_ARGS[@]}"} \
  --env BACKEND_HOST="${HOST_ADDR}" \
  --env OLLAMA_HOST="${HOST_ADDR}" \
  --env QDRANT_HOST="${HOST_ADDR}" \
  --env NEO4J_HOST="${HOST_ADDR}" \
  --env POSTGRES_HOST="${HOST_ADDR}" \
  --env SEMIONT_WORKER_SECRET="${SEMIONT_WORKER_SECRET}" \
  semiont-smelter > /dev/null

wait_for_http Smelter http://localhost:9091/health 30
ok "Smelter healthy (http://localhost:9091)"

# --- Tail logs ---

banner "Containers"
list_containers | head -1
list_containers | grep semiont- || true

echo -e "\033[2m[$(date '+%Y-%m-%d %H:%M:%S')] start.sh containers ready\033[0m"

banner "Logs"
log "Backend: semiont-backend | Worker: semiont-worker | Smelter: semiont-smelter"
log "Press Ctrl+C to stop"

sleep 2
("$RT" logs --follow semiont-backend 2>/dev/null || true) &
LOG_PIDS=("$!")
("$RT" logs --follow semiont-worker 2>/dev/null || true) &
LOG_PIDS+=("$!")
("$RT" logs --follow semiont-smelter 2>/dev/null || true) &
LOG_PIDS+=("$!")

trap 'kill "${LOG_PIDS[@]}" 2>/dev/null' EXIT
wait || true
