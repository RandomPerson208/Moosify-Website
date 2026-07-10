#!/usr/bin/env bash
# scripts/deploy.sh
# Deploy the Cloudflare Worker and exit with a helpful message if permissions are missing.

set -euo pipefail

# Helper to print a red error message
error() {
  printf "\033[31mERROR: %s\033[0m\n" "$1" >&2
}

# Verify Wrangler is installed (npx will install if missing)
if ! command -v npx >/dev/null 2>&1; then
  error "npx (Node) is not installed. Install Node.js first."
  exit 1
fi

# Check that required Cloudflare secrets are present
required_secrets=("CF_API_TOKEN" "CF_ACCOUNT_ID")
missing=()
for secret in "${required_secrets[@]}"; do
  if ! npx wrangler secret list | grep -q "$secret"; then
    missing+=("$secret")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  error "The following Cloudflare secrets are missing: ${missing[*]}"
  echo "Run the following commands to add them (you will be prompted for the value):"
  for s in "${missing[@]}"; do
    echo "  npx wrangler secret put $s"
  done
  exit 1
fi

# Deploy the worker using the current Wrangler command
echo "Deploying Cloudflare Worker..."
npx wrangler deploy

echo "✅ Deployment succeeded."
