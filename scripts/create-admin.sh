#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# create-admin.sh — Create a new admin user directly in the database
#
# Usage:
#   ./scripts/create-admin.sh \
#     --email admin@example.com \
#     --password "SecurePass1!" \
#     --first-name Jane \
#     --last-name Doe
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

EMAIL=""
PASSWORD=""
FIRST_NAME=""
LAST_NAME=""

usage() {
  echo "Usage: $0 --email EMAIL --password PASS --first-name FIRST --last-name LAST"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)      EMAIL="$2";      shift 2 ;;
    --password)   PASSWORD="$2";   shift 2 ;;
    --first-name) FIRST_NAME="$2"; shift 2 ;;
    --last-name)  LAST_NAME="$2";  shift 2 ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

[[ -z "$EMAIL" || -z "$PASSWORD" || -z "$FIRST_NAME" || -z "$LAST_NAME" ]] && usage

# ── Load DATABASE_URL from .env ───────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

DATABASE_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d'=' -f2-)

if [[ -z "$DATABASE_URL" ]]; then
  echo "Error: DATABASE_URL not found in .env"
  exit 1
fi

# ── Hash the password using bcrypt ───────────────────────────────────────────
echo "Hashing password..."

HASH=$(node -e "
const bcrypt = require('bcrypt');
bcrypt.hash(process.argv[1], 12).then(h => process.stdout.write(h));
" "$PASSWORD")

if [[ -z "$HASH" ]]; then
  echo "Error: Failed to hash password. Is bcrypt installed?"
  exit 1
fi

# ── Insert admin user into the database ──────────────────────────────────────
echo "Creating admin user $EMAIL..."

psql "$DATABASE_URL" -c "
INSERT INTO \"User\" (id, email, \"passwordHash\", \"firstName\", \"lastName\", role, \"isActive\", \"createdAt\", \"updatedAt\")
VALUES (
  gen_random_uuid(),
  '$EMAIL',
  '$HASH',
  '$FIRST_NAME',
  '$LAST_NAME',
  'admin',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING
RETURNING id, email, role, \"createdAt\";
"

echo "Done."
