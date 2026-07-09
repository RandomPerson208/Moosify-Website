#!/usr/bin/env bash
# Helper script to add required GitHub repository secrets using the GitHub CLI (gh).
# Ensure you have `gh` installed and authenticated (`gh auth login`).

set -e

# Repository URL (used by gh)
REPO=$(git config --get remote.origin.url)

set_secret() {
  name=$1
  value=$2
  if [ -z "$value" ]; then
    echo "⚠️  $name is empty – skip."
    return
  fi
  echo "🔐 Setting secret $name"
  gh secret set "$name" -b"$value" --repo "$REPO"
}

set_secret CEREBRAS_API_KEY "${CEREBRAS_API_KEY}"
set_secret GROQ_API_KEY "${GROQ_API_KEY}"
set_secret API_URL "${API_URL}"
set_secret CHAT_STATUS "${CHAT_STATUS:-up}"
set_secret CF_API_TOKEN "${CF_API_TOKEN}"
set_secret CF_ACCOUNT_ID "${CF_ACCOUNT_ID}"
