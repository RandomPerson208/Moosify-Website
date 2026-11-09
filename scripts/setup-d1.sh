#!/usr/bin/env bash
# scripts/setup-d1.sh
# Create the D1 database for saved accounts (if needed), put its id into wrangler.toml,
# and apply any new migrations. Safe to run repeatedly.
# Needs a logged-in Wrangler, or CLOUDFLARE_API_TOKEN with the D1: Edit permission.

set -euo pipefail
cd "$(dirname "$0")/.."

NAME="moosify"

if grep -q "__D1_DATABASE_ID__" wrangler.toml; then
  # Look up the database by name; create it the first time
  find_id() {
    npx wrangler d1 list --json | node -e '
      let text = "";
      process.stdin.on("data", (d) => (text += d)).on("end", () => {
        const found = JSON.parse(text).find((db) => db.name === process.argv[1]);
        if (found) console.log(found.uuid);
      });
    ' "$NAME"
  }
  ID="$(find_id)"
  if [[ -z "$ID" ]]; then
    echo "Creating D1 database '$NAME'..."
    npx wrangler d1 create "$NAME"
    ID="$(find_id)"
  fi
  if [[ -z "$ID" ]]; then
    echo "ERROR: could not find the D1 database id for '$NAME'." >&2
    exit 1
  fi
  sed -i.bak "s/__D1_DATABASE_ID__/$ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "Set database_id in wrangler.toml. Commit it so future runs skip the lookup."
fi

echo "Applying D1 migrations..."
npx wrangler d1 migrations apply "$NAME" --remote
