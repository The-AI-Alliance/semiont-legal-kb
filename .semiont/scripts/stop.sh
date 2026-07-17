#!/usr/bin/env bash
# Stop the whole Semiont stack — services, dependencies, and observability —
# and clean up the staged config copies. Safe to run when nothing is up:
# every step is a no-op then.
#
# Usage: stop.sh [--runtime container|docker|podman]
# Pass the same --runtime you started with — stopping via the wrong runtime is
# a silent no-op that leaves the real stack running. Default is first-found.
set -uo pipefail

RUNTIME=""
if [[ "${1:-}" == "--runtime" ]]; then
  RUNTIME="${2:-}"
fi
if [[ -n "$RUNTIME" ]]; then
  if ! command -v "$RUNTIME" > /dev/null 2>&1; then
    echo "--runtime $RUNTIME requested, but '$RUNTIME' is not on PATH." >&2
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
fi
if [[ -z "${RT:-}" ]]; then
  echo "No container runtime found. Install Apple Container, Docker, or Podman." >&2
  exit 1
fi

# stop-then-rm: under Apple Container a stopped --rm container persists (the
# next `run --name` would fail with "already exists"), so rm makes this
# idempotent across all three states: running, stopped, absent.
for c in semiont-backend semiont-worker semiont-smelter semiont-weaver semiont-frontend \
         semiont-neo4j semiont-qdrant semiont-postgres semiont-ollama semiont-jaeger; do
  "$RT" stop "$c" > /dev/null 2>&1 || true
  "$RT" rm "$c" > /dev/null 2>&1 || true
done

# Per-service config copies staged by start.sh for the bind mounts.
rm -rf /tmp/semiont-config.* 2>/dev/null || true

echo "Semiont stack stopped."
