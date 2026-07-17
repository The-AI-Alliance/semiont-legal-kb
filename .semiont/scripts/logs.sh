#!/usr/bin/env bash
# Follow the Semiont service logs, one [svc]-prefixed stream per service.
# Ctrl+C stops *following* — it does not stop the stack (that's stop.sh).
set -uo pipefail

for rt in container docker podman; do
  if command -v "$rt" > /dev/null 2>&1; then
    RT="$rt"
    break
  fi
done
if [[ -z "${RT:-}" ]]; then
  echo "No container runtime found. Install Apple Container, Docker, or Podman." >&2
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
