#!/usr/bin/env bash
# Follow the Semiont service logs, one [svc]-prefixed stream per service.
# Ctrl+C stops *following* — it does not stop the stack (that's stop.sh).
#
# Usage: logs.sh [--runtime container|docker|podman]
# Pass the same --runtime you started with; default is first-found.
set -uo pipefail

RUNTIME=""
if [[ "${1:-}" == "--runtime" ]]; then
  RUNTIME="${2:-}"
fi

# Find the runtime actually running the stack: following via the wrong one
# shows nothing. Anchor on semiont-backend by NAME — matching any "semiont-"
# would false-positive on unrelated containers (e.g. a local verdaccio).
stack_runtime() {
  local rt
  for rt in container docker podman; do
    command -v "$rt" > /dev/null 2>&1 || continue
    case "$rt" in
      container) "$rt" list 2>/dev/null | awk '{print $1}' | grep -qx semiont-backend && { echo "$rt"; return; } ;;
      *)         "$rt" ps --format '{{.Names}}' 2>/dev/null | grep -qx semiont-backend && { echo "$rt"; return; } ;;
    esac
  done
}

if [[ -n "$RUNTIME" ]]; then
  if ! command -v "$RUNTIME" > /dev/null 2>&1; then
    echo "--runtime $RUNTIME requested, but '$RUNTIME' is not on PATH." >&2
    exit 1
  fi
  RT="$RUNTIME"
else
  RT=$(stack_runtime)
fi
if [[ -z "${RT:-}" ]]; then
  echo "No running Semiont stack found in any runtime (container/docker/podman)." >&2
  echo "Start one with .semiont/scripts/start.sh, or pass --runtime explicitly." >&2
  exit 1
fi

echo "Following backend · worker · smelter · weaver · frontend — Ctrl+C stops following (stop.sh stops the stack)"

PIDS=()
for svc in backend worker smelter weaver frontend; do
  # 2>&1 keeps the containers' stderr in the stream — crash traces and
  # uncaught exceptions land there, and they're exactly what a log follower
  # exists to show.
  ("$RT" logs --follow "semiont-${svc}" 2>&1 | sed "s/^/[${svc}] /" || true) &
  PIDS+=("$!")
done

trap 'kill "${PIDS[@]}" 2>/dev/null' INT TERM EXIT
wait || true
