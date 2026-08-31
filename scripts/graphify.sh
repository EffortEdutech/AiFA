#!/usr/bin/env bash
# AiFA cross-platform Graphify wrapper.
# Used by Linux/macOS shells and Claude sandboxes. Installs the PyPI engine on
# demand, then forwards all arguments to graphify.
set -euo pipefail

if ! command -v graphify >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/graphify" ]; then
  echo "Installing graphifyy from PyPI..."
  pip install graphifyy --break-system-packages --quiet
fi

export PATH="$HOME/.local/bin:$PATH"
exec graphify "$@"
