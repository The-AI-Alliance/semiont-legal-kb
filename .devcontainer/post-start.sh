#!/usr/bin/env bash
set -euo pipefail

# Runs on every Codespace start, creation and resume alike. The Semiont
# launcher runs the stack here exactly as it does on a laptop.

cd "$(git rev-parse --show-toplevel)"

# This repo's owner/name, for a copy-pasteable `semiont useradd --repo`.
# Codespaces exports GITHUB_REPOSITORY; the git remote is the fallback so the
# script is also correct when run by hand outside a Codespace.
REPO_SLUG="${GITHUB_REPOSITORY:-}"
if [[ -z "$REPO_SLUG" ]]; then
  REPO_SLUG=$(git remote get-url origin 2>/dev/null |
    sed -E 's#(git@[^:]+:|https://[^/]+/)##; s#\.git$##')
fi

# The latest release, refreshed on every start: the launcher renders the
# gateway's document, and the images it pulls are the latest too. The
# releases redirect rather than the API, which rate-limits shared egress.
install_launcher() {
  local latest arch
  latest="$(curl -fsSLo /dev/null -w '%{url_effective}' https://github.com/The-AI-Alliance/semiont/releases/latest)"
  latest="${latest##*/v}"
  if [[ ! "$latest" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    echo "ERROR: cannot tell the latest Semiont release from its redirect: $latest"
    exit 1
  fi
  if command -v semiont >/dev/null && [[ "$(semiont version)" == "semiont ${latest} "* ]]; then
    return 0
  fi
  case "$(uname -m)" in
    aarch64 | arm64) arch=arm64 ;;
    *) arch=amd64 ;;
  esac
  curl -fsSL "https://github.com/The-AI-Alliance/semiont/releases/download/v${latest}/semiont_${latest}_linux_${arch}.tar.gz" |
    sudo tar xz -C /usr/local/bin semiont
  echo "Installed semiont ${latest} → /usr/local/bin/semiont"
}
install_launcher

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  cat <<EOF
WARNING: ANTHROPIC_API_KEY is not set.
  Add it as a Codespaces user secret at:
    https://github.com/settings/codespaces
  Then rebuild the container (Codespaces: Rebuild Container).

EOF
fi

if ! semiont start --runtime docker --config anthropic; then
  echo
  echo "Retry after fixing with:  bash .devcontainer/post-start.sh"
  exit 1
fi

cat <<EOF

──────────────────────────────────────────────────────────────────────
Use it from your machine (with the Semiont launcher installed)
──────────────────────────────────────────────────────────────────────
  Forward the KB and its Keycloak, and start a local Browser:

    semiont start --runtime codespace --repo ${REPO_SLUG:-<owner>/<repo>}

  Create the first account (prompts for the password; no password is
  ever passed as an argument):

    semiont useradd --repo ${REPO_SLUG:-<owner>/<repo>} \\
      --email you@example.com

  Or from a terminal in this Codespace (--generate-password prints a
  random one once; use --password-stdin to choose your own):

    semiont useradd --email you@example.com --generate-password
──────────────────────────────────────────────────────────────────────

EOF
