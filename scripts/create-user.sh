#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# create-user.sh — Create a new user via the admin API
#
# Usage:
#   ./scripts/create-user.sh \
#     --email jane@example.com \
#     --first-name Jane \
#     --last-name Doe \
#     --admin-email admin@example.com \
#     --admin-password "AdminPass1!" \
#     [--api-url http://localhost:3000] \
#     [--send-invite]
# ---------------------------------------------------------------------------

API_URL="http://localhost:3000"
SEND_INVITE=false
EMAIL=""
FIRST_NAME=""
LAST_NAME=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""

usage() {
  echo "Usage: $0 --email EMAIL --first-name FIRST --last-name LAST --admin-email EMAIL --admin-password PASS [--api-url URL] [--send-invite]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)           EMAIL="$2";          shift 2 ;;
    --first-name)      FIRST_NAME="$2";     shift 2 ;;
    --last-name)       LAST_NAME="$2";      shift 2 ;;
    --admin-email)     ADMIN_EMAIL="$2";    shift 2 ;;
    --admin-password)  ADMIN_PASSWORD="$2"; shift 2 ;;
    --api-url)         API_URL="$2";        shift 2 ;;
    --send-invite)     SEND_INVITE=true;    shift ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

[[ -z "$EMAIL" || -z "$FIRST_NAME" || -z "$LAST_NAME" || -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]] && usage

# ── Step 1: Log in as admin ──────────────────────────────────────────────────
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

# ── Step 2: Create the user ──────────────────────────────────────────────────
echo "Creating user $EMAIL..."

CREATE_RESPONSE=$(curl -sf -X POST "$API_URL/api/admin/users" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"email\": \"$EMAIL\", \"firstName\": \"$FIRST_NAME\", \"lastName\": \"$LAST_NAME\"}")

USER_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [[ -z "$USER_ID" ]]; then
  echo "Error: Failed to create user. Response: $CREATE_RESPONSE"
  exit 1
fi

echo "User created. ID: $USER_ID"

# ── Step 3 (optional): Send invite email ─────────────────────────────────────
if [[ "$SEND_INVITE" == true ]]; then
  echo "Sending invite email to $EMAIL..."

  INVITE_RESPONSE=$(curl -sf -X POST "$API_URL/api/admin/users/$USER_ID/invite" \
    -H "Authorization: Bearer $TOKEN")

  echo "Invite sent."
fi

echo "Done."
