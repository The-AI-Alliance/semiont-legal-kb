#!/usr/bin/env bash
set -euo pipefail

# Runs once on Codespace creation. Generates the per-codespace secrets and
# warms the image cache. All images are published (ghcr.io) — nothing is
# built here, and no user account is created (see post-start.sh's closing
# instructions: `semiont useradd` makes the first admin).

cd "$(git rev-parse --show-toplevel)"

ENV_FILE=".devcontainer/.env"
touch "$ENV_FILE"

# Per-codespace secrets, generated once and KEPT.
#
# Appended, never overwritten, so adding a second secret cannot erase the first.
#
# Never regenerate one that already exists: rotating JWT_SECRET invalidates
# every token the KB has issued, which strands logged-in clients and leaves
# in-flight jobs waiting on replies they can no longer authenticate.
#
# The local path does not come through here — `semiont start` generates and
# injects JWT_SECRET per KB root. This is the codespace equivalent, and it was
# missing: the gateway requires the secret and crash-looped without it.
ensure_secret() {
  local name="$1"
  if ! grep -q "^${name}=" "$ENV_FILE"; then
    echo "${name}=$(openssl rand -hex 32)" >> "$ENV_FILE"
    echo "Generated ${name} → $ENV_FILE"
  fi
}
ensure_secret JWT_SECRET

# The Semiont launcher. Every `semiont` verb — useradd included — runs HERE
# when the codespace is the stack's host, so the realm's admin credential stays
# in this machine's environment and never crosses a wire.
#
# The release archive rather than the Homebrew tap: brew on a devcontainer
# base image is a multi-minute install for one static binary.
install_launcher() {
  command -v semiont >/dev/null && return 0
  local ver arch
  ver="$(curl -fsSL https://api.github.com/repos/The-AI-Alliance/semiont/releases/latest |
    grep -m1 '"tag_name"' | cut -d'"' -f4)"
  ver="${ver#v}"
  case "$(uname -m)" in
    aarch64 | arm64) arch=arm64 ;;
    *) arch=amd64 ;;
  esac
  curl -fsSL "https://github.com/The-AI-Alliance/semiont/releases/download/v${ver}/semiont_${ver}_linux_${arch}.tar.gz" |
    sudo tar xz -C /usr/local/bin semiont
  echo "Installed semiont ${ver} → /usr/local/bin/semiont"
}
install_launcher

COMPOSE_BASE=(--env-file "$ENV_FILE" \
  -f .semiont/compose/backend.yml \
  -f .devcontainer/docker-compose.codespaces.yml)

# Pull all images — the five published Semiont images plus the infra
# (neo4j, qdrant, postgres, ollama, jaeger).
docker compose "${COMPOSE_BASE[@]}" --profile observe pull

# Make .devcontainer/.env auto-sourced in interactive shells so the user can
# run `docker compose …` without compose blowing up on missing variables.
ENV_FILE_ABS="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
SOURCE_LINE="[ -f \"$ENV_FILE_ABS\" ] && set -a && . \"$ENV_FILE_ABS\" && set +a"
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [[ -f "$rc" ]] && ! grep -qF "$ENV_FILE_ABS" "$rc"; then
    {
      echo ""
      echo "# semiont-template-kb: source per-codespace env"
      echo "$SOURCE_LINE"
    } >> "$rc"
  fi
done
