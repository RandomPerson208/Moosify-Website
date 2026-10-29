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

# Deploying needs a logged-in Wrangler or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
# (CF_API_TOKEN / CF_ACCOUNT_ID are GitHub Actions secrets, not Worker secrets.)
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] && ! npx wrangler whoami >/dev/null 2>&1; then
  error "Not logged in to Cloudflare."
  echo "Run 'npx wrangler login', or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID."
  exit 1
fi

# Warn (but don't block) when optional Worker secrets are missing
existing=$(npx wrangler secret list 2>/dev/null || true)
for secret in GOOGLE_CLIENT_ID SESSION_SECRET; do
  if ! grep -q "\"$secret\"" <<<"$existing"; then
    echo "Note: Worker secret $secret is not set, so login stays off. Add it with: npx wrangler secret put $secret"
  fi
done

# Deploy the worker using the current Wrangler command
echo "Deploying Cloudflare Worker..."
npx wrangler deploy

echo "✅ Deployment succeeded."
