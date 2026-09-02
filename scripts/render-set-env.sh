#!/usr/bin/env bash
#
# render-set-env.sh — set ONE environment variable on ONE Render service.
#
# This exists to be permission-allowlisted. It is deliberately the narrowest
# possible capability: it can set a single env var on a single service and can
# do nothing else. It cannot create, delete, suspend or deploy a service, cannot
# read any value back, and cannot touch a database or key-value instance.
#
# The VALUE IS READ FROM STDIN, never from argv, so a secret never appears in
# the process list, in shell history, or in a transcript.
#
# Usage:
#   printf '%s' "$SECRET" | scripts/render-set-env.sh srv-xxxxxxxxxxxx VAR_NAME
#   scripts/render-set-env.sh srv-xxxxxxxxxxxx VAR_NAME < value.txt
#
# Credential: api.key from ~/.render/cli.yaml (the Render CLI's own token).
#
# NOTE: Render injects environment at DEPLOY time, not on restart. Setting a
# variable does NOT trigger a deploy and does NOT take effect until the next
# one. Deploy separately, and set every variable you intend BEFORE deploying —
# a variable set after a deploy starts will miss it.

set -euo pipefail

SERVICE_ID="${1:-}"
VAR_NAME="${2:-}"

if [[ -z "$SERVICE_ID" || -z "$VAR_NAME" ]]; then
  echo "usage: printf '%s' \"\$VALUE\" | $0 <srv-id> <VAR_NAME>" >&2
  exit 2
fi

# Fail closed on anything that is not plainly a Render service id or a
# conventional env var name, so this can never be pointed somewhere else.
if [[ ! "$SERVICE_ID" =~ ^srv-[a-z0-9]+$ ]]; then
  echo "refusing: '$SERVICE_ID' is not a Render service id (expected srv-…)" >&2
  exit 2
fi
if [[ ! "$VAR_NAME" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
  echo "refusing: '$VAR_NAME' is not a conventional env var name" >&2
  exit 2
fi

CLI_CONFIG="${HOME}/.render/cli.yaml"
if [[ ! -r "$CLI_CONFIG" ]]; then
  echo "refusing: cannot read $CLI_CONFIG" >&2
  exit 1
fi

# Read stdin exactly as given — no trailing-newline munging, because some keys
# are length-checked and a stray byte is a boot failure.
VALUE="$(cat)"
if [[ -z "$VALUE" ]]; then
  echo "refusing: empty value on stdin (use the Render dashboard to unset)" >&2
  exit 2
fi

STATUS="$(
  RENDER_CLI_CONFIG="$CLI_CONFIG" \
  SL_SERVICE_ID="$SERVICE_ID" SL_VAR_NAME="$VAR_NAME" SL_VALUE="$VALUE" \
  python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error, yaml

key = yaml.safe_load(open(os.environ["RENDER_CLI_CONFIG"]))["api"]["key"]
sid = os.environ["SL_SERVICE_ID"]
var = os.environ["SL_VAR_NAME"]

req = urllib.request.Request(
    f"https://api.render.com/v1/services/{sid}/env-vars/{var}",
    data=json.dumps({"value": os.environ["SL_VALUE"]}).encode(),
    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    method="PUT",
)
try:
    print(urllib.request.urlopen(req).status)
except urllib.error.HTTPError as e:
    # Never echo the response body — it can contain the value.
    print(f"HTTP_{e.code}")
    sys.exit(1)
PY
)"

echo "${VAR_NAME} on ${SERVICE_ID}: ${STATUS}"
