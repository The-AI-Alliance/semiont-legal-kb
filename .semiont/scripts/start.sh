#!/usr/bin/env bash
set -euo pipefail

# Start a local Semiont stack — backend services and frontend — in containers.

echo -e "\033[2m[$(date '+%Y-%m-%d %H:%M:%S')] start.sh started\033[0m"

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

# Wait for Postgres, in two phases. Phase 1 polls the published port from the
# host via bash's /dev/tcp — no container spawn per attempt (the old
# pg_isready-in-a-container loop cost a fresh VM per attempt under Apple
# Container). Port-open implies ready with the official postgres image: its
# init-time temporary server listens on the unix socket only, so TCP 5432
# opens only when the real server is up. Phase 2 is a single container-side
# probe confirming the gateway path the services actually dial (mirrors the
# backend reachability check).
wait_for_pg() {
  local host=$1 port=$2 tries=${3:-30} up=false
  for _ in $(seq 1 "$tries"); do
    if (echo > "/dev/tcp/localhost/${port}") 2>/dev/null; then
      up=true
      break
    fi
    sleep 1
  done
  if ! $up; then
    fail "PostgreSQL did not open port ${port} within ${tries}s."
    exit 1
  fi
  if ! "$RT" run --rm busybox:1.38.0 nc -z -w 2 "$host" "$port" > /dev/null 2>&1; then
    fail "PostgreSQL is up on localhost:${port} but not reachable from containers at ${host}:${port}."
    exit 1
  fi
}

# Run one of the three make-meaning sidecars (worker / smelter / weaver).
# They are identical in shape — private config copy mounted at
# ~/.semiontconfig, gateway addressing, worker secret, health wait — and
# differ only in name, display label, port, and memory. The backend and
# frontend keep bespoke blocks below: their differences (the /kb mount and
# admin bootstrap; a config-free static server) are the point.
start_sidecar() {
  local svc=$1 label=$2 port=$3 mem=$4
  run_cmd "$RT" run -d --rm \
    --name "semiont-${svc}" \
    --memory "$mem" \
    --publish "${port}:${port}" \
    --volume "${CONFIG_STAGE}/${svc}.toml:/home/semiont/.semiontconfig:ro" \
    ${USER_ENV_ARGS[@]+"${USER_ENV_ARGS[@]}"} \
    ${OTEL_ARGS[@]+"${OTEL_ARGS[@]}"} \
    "${GATEWAY_ENV_ARGS[@]}" \
    --env SEMIONT_WORKER_SECRET="${SEMIONT_WORKER_SECRET}" \
    "${IMAGE_REGISTRY}/semiont-${svc}:${SEMIONT_VERSION}" > /dev/null
  wait_for_http "$label" "http://localhost:${port}/health" 30
  ok "$label healthy (http://localhost:${port})"
}

# Fail if a TCP port is already in use, naming the offending process(es). With
# FORCE_KILL_PORTS=true, kill the holders and verify the port is free instead.
# lsof -ti prints one PID per line when several processes hold a port
# (parent+child servers, SO_REUSEPORT), so every consumer iterates per line —
# a quoted "$pids" would hand kill/ps a single newline-embedded argument.
require_port_free() {
  local port=$1 service=$2 pids p procs
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  if [[ -z "$pids" ]]; then return 0; fi
  procs=""
  while IFS= read -r p; do
    procs="${procs:+$procs, }${p} ($(ps -p "$p" -o comm= 2>/dev/null || echo '<unknown>'))"
  done <<< "$pids"
  if $FORCE_KILL_PORTS; then
    warn "Port $port (needed for $service) held by ${procs} — killing (--force-kill-ports)."
    while IFS= read -r p; do
      kill "$p" 2>/dev/null || true
    done <<< "$pids"
    sleep 1
    pids=$(lsof -ti ":$port" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
      fail "Port $port still held after kill ($(echo "$pids" | tr '\n' ' '))."
      exit 1
    fi
    return 0
  fi
  fail "Port $port (needed for $service) is held by ${procs}."
  echo "  Stop the conflicting process and re-run, or pass --force-kill-ports." >&2
  exit 1
}

# --- Parse arguments ---

CONFIG_NAME="ollama-gemma"
CONFIG_DIR=".semiont/semiontconfig"
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
CLEAN_OLLAMA=false
LIST_CONFIGS=false
FORCE_KILL_PORTS=false
OBSERVE=true
RUNTIME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_NAME="$2"; shift 2 ;;
    --list-configs) LIST_CONFIGS=true; shift ;;
    --email) ADMIN_EMAIL="$2"; shift 2 ;;
    --password) ADMIN_PASSWORD="$2"; shift 2 ;;
    --clean-ollama) CLEAN_OLLAMA=true; shift ;;
    --force-kill-ports) FORCE_KILL_PORTS=true; shift ;;
    --runtime) RUNTIME="$2"; shift 2 ;;
    --no-observe) OBSERVE=false; shift ;;
    --quiet|-q) QUIET=true; shift ;;
    --help|-h)
      echo "Usage: start.sh [options]"
      echo ""
      echo "Start a local Semiont stack with Neo4j, Qdrant, Ollama, PostgreSQL,"
      echo "the Semiont API server, worker, smelter, weaver, and the frontend"
      echo "(http://localhost:3000) — all in containers."
      echo ""
      echo "Options:"
      echo "  --config <name>       Semiontconfig to use (default: ollama-gemma)"
      echo "  --list-configs        List available configs and exit"
      echo "  --email <email>       Admin user email (requires --password)"
      echo "  --password <pass>     Admin user password (requires --email)"
      echo "  --clean-ollama        Remove the Ollama model cache volume and exit"
      echo "  --force-kill-ports    Kill any non-Semiont process holding a needed port"
      echo "  --runtime <name>      Container runtime: container, docker, or podman (default: first found)"
      echo "  --no-observe          Skip the Jaeger sidecar (OTel traces + metrics run by default)"
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

# --- Resolve KB root ---
#
# Everything below is repo-root-relative. A git clone is required — the backend
# versions the event log via git — so fail with instructions rather than git's
# opaque "not a repository" fatal when someone used GitHub's "Download ZIP"
# (or has no git at all). Deliberately after arg parsing so --help works
# anywhere.

if ! ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
  fail "This must run inside a git clone of the KB (the backend versions the event log via git)."
  echo "  If you used GitHub's 'Download ZIP', clone the repository instead:  git clone <repo-url>" >&2
  exit 1
fi
cd "$ROOT"

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

# --- Select container runtime ---
#
# --runtime forces a specific one (e.g. testing the docker path on a machine
# where Apple Container would win the auto-detect); default is first-found.

if [[ -n "$RUNTIME" ]]; then
  case "$RUNTIME" in
    container|docker|podman) ;;
    *) fail "Unknown --runtime '$RUNTIME' (expected: container, docker, or podman)"; exit 1 ;;
  esac
  if ! command -v "$RUNTIME" > /dev/null 2>&1; then
    fail "--runtime $RUNTIME requested, but '$RUNTIME' is not on PATH."
    exit 1
  fi
  RT="$RUNTIME"
else
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

# Published service images are consumed by version (they ship config-free): we
# pull each explicitly below (a `run` alone will NOT refresh a cached mutable tag
# like :latest), and the selected config TOML is bind-mounted into every container
# at runtime. SEMIONT_VERSION=local uses locally-built :local images (from the
# local dev-build script) and skips the pull.
SEMIONT_VERSION="${SEMIONT_VERSION:-latest}"
IMAGE_REGISTRY="ghcr.io/the-ai-alliance"

banner "Semiont Local Backend"
log "Container runtime: ${BOLD}${RT}${RESET}"
log "Config: ${BOLD}${CONFIG_NAME}${RESET}"
log "Image version: ${BOLD}${SEMIONT_VERSION}${RESET}"

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
#
# Every inter-service hop dials the HOST (hub-and-spoke over published ports),
# so this must be an address that reaches the host FROM INSIDE a container —
# and that is runtime-specific:
#   - Apple container: one VM per container; the default gateway on the shared
#     bridge IS the Mac host. The gateway probe is correct.
#   - Docker Desktop (mac/win): the bridge gateway is internal to Docker's
#     Linux VM and does NOT reach the host (measured: host Ollama on 0.0.0.0
#     was unreachable at 172.17.0.1). The injected DNS name
#     host.docker.internal does. Docker on Linux injects no such name by
#     default — there the bridge gateway DOES reach host-published ports, so
#     the gateway probe is the fallback.
#   - podman: same pattern with host.containers.internal.
# Probe, don't assume: prefer the runtime's host alias when it resolves
# inside a container; otherwise fall back to the default-gateway probe.

resolve_host_addr() {
  local alias=""
  case "$RT" in
    docker) alias=host.docker.internal ;;
    podman) alias=host.containers.internal ;;
  esac
  if [[ -n "$alias" ]] && "$RT" run --rm busybox:1.38.0 nslookup "$alias" > /dev/null 2>&1; then
    echo "$alias"
    return
  fi
  "$RT" run --rm busybox:1.38.0 sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]'
}

HOST_ADDR=$(resolve_host_addr)
if [[ -z "$HOST_ADDR" ]]; then
  fail "Could not determine host address for container networking."
  echo "  Neither the runtime's host alias nor the default-gateway probe returned a result." >&2
  exit 1
fi
log "Host address: ${DIM}${HOST_ADDR}${RESET}"

# Every service dials its dependencies through the host gateway (hub-and-spoke
# over published ports — the addressing model all runtimes share).
GATEWAY_ENV_ARGS=(
  --env BACKEND_HOST="$HOST_ADDR"
  --env OLLAMA_HOST="$HOST_ADDR"
  --env NEO4J_HOST="$HOST_ADDR"
  --env QDRANT_HOST="$HOST_ADDR"
  --env POSTGRES_HOST="$HOST_ADDR"
)

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
for c in semiont-jaeger semiont-neo4j semiont-qdrant semiont-postgres semiont-backend semiont-worker semiont-smelter semiont-weaver semiont-frontend; do
  run_cmd "$RT" stop "$c" 2>/dev/null || true
  run_cmd "$RT" rm "$c" 2>/dev/null || true
done
# Staged config copies from previous runs (stop.sh also removes these). Safe
# to delete only here, after the old stack's containers (which mounted them)
# are stopped — and this run's own staging is deliberately created below,
# after this sweep, so no exclusion dance is needed.
rm -rf /tmp/semiont-config.* 2>/dev/null || true
sleep 1

require_port_free 7474 "Neo4j HTTP"
require_port_free 7687 "Neo4j Bolt"
require_port_free 6333 "Qdrant"
require_port_free 5432 "PostgreSQL"
require_port_free 4000 "Backend"
require_port_free 9090 "Worker"
require_port_free 9091 "Smelter"
require_port_free 9092 "Weaver"
require_port_free 3000 "Frontend"
if $OBSERVE; then
  require_port_free 16686 "Jaeger UI"
  require_port_free 4318 "Jaeger OTLP"
fi
ok "Required ports are free"

# --- Stage per-service config copies ---
#
# Each service gets its OWN copy of the config to mount — do not "simplify"
# this back to one shared file. Under Apple Container (one VM per container,
# each with its own virtiofs share), mounting the same host file into a second
# VM transiently breaks existing mounts of that file in other VMs: a 50ms-
# interval read loop showed reads failing for ~100ms exactly when another
# container mounted the same file. The backend is the victim: its CMD re-reads
# ~/.semiontconfig across several CLI invocations (provision → start → useradd)
# while the worker/smelter/weaver launch and mount theirs, and the CLI treats
# an unreadable config as "not configured" — so a shared file intermittently
# killed a healthy backend mid-chain ("Environment not specified"). Private
# copies mean no host file is ever mounted twice, closing the race outright.
#
# docker/podman don't need this (single shared VM / native bind mounts), but
# the copies are harmless there, so one code path serves all runtimes. The
# staging dir deliberately outlives this script — the running containers mount
# these copies, and deleting the backing files under a live mount would
# recreate the very read-failure class this exists to prevent. stop.sh (and
# the next run's preflight sweep, which runs before this point) removes it.
# Copies are made fresh each run, so the repo TOMLs stay the single source of
# truth.
#
# The staging dir MUST be under /tmp, not $TMPDIR: Apple Container cannot
# sustain mounts from /var/folders (macOS's per-user private temp) — the first
# read succeeds, then every subsequent read fails (measured: 1 ok / 29 fail over
# 30s, vs 30/30 ok from /tmp), which killed the backend on its second CLI
# invocation.

CONFIG_STAGE=$(mktemp -d /tmp/semiont-config.XXXXXX)
for svc in backend worker smelter weaver; do
  cp "$CONFIG_FILE" "${CONFIG_STAGE}/${svc}.toml"
done

# --- Pull service images ---
#
# Pull explicitly (up front, so a bad version/registry fails before any dep
# containers start) — a `run` alone reuses a cached :latest and never refreshes
# it. Pull is not portable across runtimes: Apple `container` uses `image pull`,
# docker/podman use `pull`. SEMIONT_VERSION=local uses locally-built images.

banner "Pulling Images"
if [[ "$SEMIONT_VERSION" == "local" ]]; then
  log "Using locally-built ${BOLD}:local${RESET} images (skipping pull)"
else
  for svc in backend worker smelter weaver frontend; do
    img="${IMAGE_REGISTRY}/semiont-${svc}:${SEMIONT_VERSION}"
    case "$RT" in
      container) run_cmd "$RT" image pull "$img" ;;
      *)         run_cmd "$RT" pull "$img" ;;
    esac
  done
  ok "Images pulled"
fi

# --- Jaeger (observability) ---
#
# On by default (skip with --no-observe): run jaegertracing/all-in-one and
# configure the Semiont processes to push OTLP traces + metrics there. The
# doc's Tier 3 metrics export over the same endpoint, so one env var covers
# both.

OTEL_ARGS=()
if $OBSERVE; then
  banner "Jaeger"
  run_cmd "$RT" run -d --rm \
    --name semiont-jaeger \
    -p 16686:16686 \
    -p 4318:4318 \
    jaegertracing/all-in-one:1.76.0 > /dev/null
  wait_for_http "Jaeger UI" http://localhost:16686 30
  ok "Jaeger UI on http://localhost:16686 (OTLP collector: ${HOST_ADDR}:4318)"
  OTEL_ARGS=(--env OTEL_EXPORTER_OTLP_ENDPOINT="http://${HOST_ADDR}:4318")
fi

# --- Neo4j ---

banner "Neo4j"

run_cmd "$RT" run -d --rm \
  --name semiont-neo4j \
  -p 7474:7474 \
  -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/localpass \
  -e NEO4J_ACCEPT_LICENSE_AGREEMENT=yes \
  neo4j:5.26.28-community > /dev/null

wait_for_http Neo4j http://localhost:7474 30
ok "Neo4j on bolt://localhost:7687 (browser: http://localhost:7474)"

# --- Qdrant ---

banner "Qdrant"

run_cmd "$RT" run -d --rm \
  --name semiont-qdrant \
  -p 6333:6333 \
  qdrant/qdrant:v1.18.3 > /dev/null

wait_for_http Qdrant http://localhost:6333/readyz 15
ok "Qdrant on http://localhost:6333"

# --- Ollama ---

OLLAMA_NAME="semiont-ollama"
banner "Ollama"

if curl -sf http://localhost:11434/api/version > /dev/null 2>&1; then
  # Host Ollama detected — verify it's reachable from containers
  if "${RT}" run --rm busybox:1.38.0 sh -c "wget -q -O- http://${HOST_ADDR}:11434/api/version" > /dev/null 2>&1; then
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

banner "PostgreSQL"

run_cmd "$RT" run -d --rm \
  --name semiont-postgres \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=localpass \
  -e POSTGRES_DB=semiont \
  postgres:15.18-alpine > /dev/null

wait_for_pg "$HOST_ADDR" 5432 20
ok "PostgreSQL on port 5432"

# --- Generate worker secret ---

SEMIONT_WORKER_SECRET="${SEMIONT_WORKER_SECRET:-$(openssl rand -hex 32)}"
log "Worker secret: ${DIM}(generated)${RESET}"

# --- Run backend ---

banner "Starting Backend"
log "http://localhost:4000"

ADMIN_ARGS=()
if [[ -n "$ADMIN_EMAIL" && -n "$ADMIN_PASSWORD" ]]; then
  ADMIN_ARGS=(--env ADMIN_EMAIL="$ADMIN_EMAIL" --env ADMIN_PASSWORD="$ADMIN_PASSWORD")
  log "Admin user: ${BOLD}${ADMIN_EMAIL}${RESET}"
fi

# Note: no GATEWAY_ENV_ARGS here — the backend takes the four dependency
# hosts but must NOT receive BACKEND_HOST (publicURL derives from it;
# see the DID/site.domain history before changing this).
run_cmd "$RT" run -d --rm \
  --name semiont-backend \
  --publish 4000:4000 \
  --memory 8G \
  --volume "$(pwd)":/kb \
  --volume "${CONFIG_STAGE}/backend.toml:/home/semiont/.semiontconfig:ro" \
  ${USER_ENV_ARGS[@]+"${USER_ENV_ARGS[@]}"} \
  ${OTEL_ARGS[@]+"${OTEL_ARGS[@]}"} \
  --env POSTGRES_HOST="$HOST_ADDR" \
  --env NEO4J_HOST="$HOST_ADDR" \
  --env QDRANT_HOST="${HOST_ADDR}" \
  --env OLLAMA_HOST="${HOST_ADDR}" \
  --env SEMIONT_WORKER_SECRET="${SEMIONT_WORKER_SECRET}" \
  ${ADMIN_ARGS[@]+"${ADMIN_ARGS[@]}"} \
  "${IMAGE_REGISTRY}/semiont-backend:${SEMIONT_VERSION}" > /dev/null

log "Waiting for backend health..."
wait_for_http Backend http://localhost:4000/api/health 120
ok "Backend healthy"

# The worker/smelter/weaver reach the backend from inside a container over the
# gateway (${HOST_ADDR}:4000), not localhost — and each fatally exits if its
# first backend fetch fails. The health check above is from the host, so also
# confirm the gateway path is reachable before starting the dependents (mirrors
# the Ollama reachability probe above).
log "Verifying backend reachable from containers..."
backend_reachable=false
for _ in $(seq 1 20); do
  if "$RT" run --rm busybox:1.38.0 sh -c "wget -q -O- http://${HOST_ADDR}:4000/api/health" > /dev/null 2>&1; then
    backend_reachable=true
    break
  fi
  sleep 1
done
if $backend_reachable; then
  ok "Backend reachable from containers"
else
  fail "Backend not reachable from containers at ${HOST_ADDR}:4000 within 20s."
  exit 1
fi

# --- Run the make-meaning sidecars ---
#
# The weaver note: the graph projection is standalone-only — the backend no
# longer applies events to Neo4j in-process. Without the weaver the graph
# stays empty and every gather 404s at the buildKnowledgeGraph barrier. Its
# health reports readiness before catch-up completes; /health exposes
# catchUp/reconcile phases for anyone who needs to watch it converge.

banner "Starting Worker Pool"
start_sidecar worker "Worker pool" 9090 2G

banner "Starting Smelter"
start_sidecar smelter "Smelter" 9091 2G

banner "Starting Weaver"
start_sidecar weaver "Weaver" 9092 3G

# --- Run frontend ---
#
# A static SPA server (@semiont/frontend server.js): no config mount and no
# service env — the browser talks to the backend directly on localhost:4000.

banner "Starting Frontend"

run_cmd "$RT" run -d --rm \
  --name semiont-frontend \
  --memory 1G \
  --publish 3000:3000 \
  "${IMAGE_REGISTRY}/semiont-frontend:${SEMIONT_VERSION}" > /dev/null

wait_for_http Frontend http://localhost:3000 30
ok "Frontend on http://localhost:3000"

# --- Summary; the stack runs detached and this script exits ---
#
# Best practice for multi-service launchers (compose up -d, supabase start):
# bring the stack up, say where everything is, and get out of the way. Logs
# and teardown are explicit follow-up commands (logs.sh / stop.sh) rather
# than a resident supervisor. URLs are printed bare because terminals
# auto-link plain URLs; OSC 8 hyperlink support is uneven (Terminal.app).

echo -e "\033[2m[$(date '+%Y-%m-%d %H:%M:%S')] start.sh containers ready\033[0m"

echo ""
echo -e "${BOLD}${GREEN}Semiont stack is up${RESET}"
echo ""
echo -e "  Semiont Browser    ${BOLD}http://localhost:3000${RESET}"
echo -e "  Semiont KB         http://localhost:4000"
echo -e "  Neo4j Browser      http://localhost:7474   ${DIM}(neo4j / localpass)${RESET}"
echo -e "  Qdrant Dashboard   http://localhost:6333/dashboard"
if $OBSERVE; then
  echo -e "  Jaeger UI          http://localhost:16686"
fi
echo ""
if [[ -n "$ADMIN_EMAIL" ]]; then
  echo -e "  Sign in at http://localhost:3000 as ${BOLD}${ADMIN_EMAIL}${RESET} with your --password."
  echo ""
fi
echo -e "  Follow logs:   ${BOLD}.semiont/scripts/logs.sh${RESET}"
echo -e "  Stop stack:    ${BOLD}.semiont/scripts/stop.sh${RESET}"
echo ""
