#!/bin/sh
set -e

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"

FILENAME="backup-$(date -u +%Y-%m-%dT%H-%M-%SZ).sql.gz"
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "Starting backup: $FILENAME"

pg_dump "$DATABASE_URL" \
  | gzip \
  | AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws s3 cp - "s3://${R2_BUCKET}/${FILENAME}" \
      --endpoint-url "$ENDPOINT" \
      --region auto

echo "Backup complete: $FILENAME"
