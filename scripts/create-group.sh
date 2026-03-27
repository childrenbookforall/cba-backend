#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# create-group.sh — Create a new group via the admin API
#
# Usage:
#   ./scripts/create-group.sh \
#     --name "General" \
#     --slug "general" \
#     --admin-email admin@example.com \
#     --admin-password "AdminPass1!" \
#     [--description "A general discussion group"] \
#     [--api-url http://localhost:3000]
# ---------------------------------------------------------------------------

API_URL="http://localhost:3000"
NAME=""
SLUG=""
DESCRIPTION=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""

usage() {
  echo "Usage: $0 --name NAME --slug SLUG --admin-email EMAIL --admin-password PASS [--description DESC] [--api-url URL]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)            NAME="$2";           shift 2 ;;
    --slug)            SLUG="$2";           shift 2 ;;
    --description)     DESCRIPTION="$2";    shift 2 ;;
    --admin-email)     ADMIN_EMAIL="$2";    shift 2 ;;
    --admin-password)  ADMIN_PASSWORD="$2"; shift 2 ;;
    --api-url)         API_URL="$2";        shift 2 ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

[[ -z "$NAME" || -z "$SLUG" || -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]] && usage

# ── Step 1: Log in as admin ───────────────────────────────────────────────────
echo "Logging in as $ADMIN_EMAIL..."

LOGIN_RESPONSE=$(curl -sf -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASSWORD\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [[ -z "$TOKEN" ]]; then
  echo "Error: Login failed. Check your admin credentials."
  exit 1
fi

echo "Login successful."

# ── Step 2: Create the group ──────────────────────────────────────────────────
echo "Creating group '$NAME'..."

BODY="{\"name\": \"$NAME\", \"slug\": \"$SLUG\""
[[ -n "$DESCRIPTION" ]] && BODY="$BODY, \"description\": \"$DESCRIPTION\""
BODY="$BODY}"

RESPONSE=$(curl -sf -X POST "$API_URL/api/admin/groups" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$BODY")

GROUP_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [[ -z "$GROUP_ID" ]]; then
  echo "Error: Failed to create group. Response: $RESPONSE"
  exit 1
fi

echo "Group created. ID: $GROUP_ID"
