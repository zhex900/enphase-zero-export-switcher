#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/set-pulumi-config-from-env.sh <stack>
# Reads .env from repo root and sets Pulumi config keys (UPPERCASE) for the stack.

STACK=${1:-}
if [[ -z "$STACK" ]]; then
  echo "Usage: $0 <stack>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/../.. && pwd)"
echo "ROOT_DIR: $ROOT_DIR"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo ".env not found at $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC2046
export $(grep -v '^#' "$ENV_FILE" | xargs -I{} echo {})

pulumi stack select "$STACK" >/dev/null
echo "Pulumi stack AMBER_SITE_ID: $AMBER_SITE_ID"

# # Non-secret
# pulumi config set AMBER_SITE_ID "${AMBER_SITE_ID:-}" --stack "$STACK"
# pulumi config set ENPHASE_SYSTEM_ID "${ENPHASE_SYSTEM_ID:-}" --stack "$STACK"
# pulumi config set ENPHASE_SERIAL_NUMBER "${ENPHASE_SERIAL_NUMBER:-}" --stack "$STACK"
# pulumi config set ENPHASE_PART_NUMBER "${ENPHASE_PART_NUMBER:-}" --stack "$STACK"
# pulumi config set ENPHASE_GRID_PROFILE_NAME_ZERO_EXPORT_ID "${ENPHASE_GRID_PROFILE_NAME_ZERO_EXPORT_ID:-}" --stack "$STACK"
# pulumi config set ENPHASE_GRID_PROFILE_NAME_NORMAL_EXPORT_ID "${ENPHASE_GRID_PROFILE_NAME_NORMAL_EXPORT_ID:-}" --stack "$STACK"

# # Secrets
# if [[ -n "${AMBER_TOKEN:-}" ]]; then pulumi config set --secret AMBER_TOKEN "$AMBER_TOKEN" --stack "$STACK"; fi
# if [[ -n "${ENPHASE_EMAIL:-}" ]]; then pulumi config set --secret ENPHASE_EMAIL "$ENPHASE_EMAIL" --stack "$STACK"; fi
# if [[ -n "${ENPHASE_PASSWORD:-}" ]]; then pulumi config set --secret ENPHASE_PASSWORD "$ENPHASE_PASSWORD" --stack "$STACK"; fi

# echo "Pulumi config set for stack $STACK from .env"


