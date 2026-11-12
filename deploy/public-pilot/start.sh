#!/bin/sh
set -eu
umask 077
data=/pilot-data
model=/opt/pilot-model/model.gguf
expected=8cdb57cbb880d313736a9bc4e3d3d2485f145b5e19cf33783746e753e82641fc

if ! mountpoint -q "$data"; then
  printf 'Pilot requires a persistent volume at /pilot-data.\n' >&2
  exit 1
fi
if [ ! -s "$model" ] || [ -z "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  printf 'The pinned model and service domain are required.\n' >&2
  exit 1
fi
printf '%s  %s\n' "$expected" "$model" | sha256sum -c -
chmod 0700 "$data"
node /app/deploy/initialize.mjs "$data"
chown node:node "$data" "$data"/advice.sqlite "$data"/release.json "$data"/accounts.json "$data"/local-model.key

export LD_LIBRARY_PATH=/opt/llama
export DAI_TIN_PUBLIC_PILOT_PLATFORM=railway DAI_TIN_ADVICE_MODEL_SHA256="$expected"
export DAI_TIN_MODEL_MODE=enabled DAI_TIN_MODEL_PORT=9942 DAI_TIN_MODEL_ID=qwen3-4b-instruct-2507-q4_k_m
export DAI_TIN_MODEL_KEY_FILE="$data/local-model.key"
unset PILOT_BINH_KEY PILOT_GRADER_KEY DAI_TIN_MODEL_ENDPOINT
gosu node /opt/llama/llama-server --host 127.0.0.1 --port 9942 --model "$model" \
  --alias "$DAI_TIN_MODEL_ID" --api-key-file "$DAI_TIN_MODEL_KEY_FILE" --ctx-size 8192 --parallel 1 \
  --threads 4 --n-gpu-layers 0 --log-disable &
model_pid=$!
app_pid=''
cleanup() {
  if [ -n "$app_pid" ]; then kill "$app_pid" 2>/dev/null || true; fi
  kill "$model_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

elapsed=0
until curl -fsS --max-time 1 http://127.0.0.1:9942/health >/dev/null 2>&1; do
  kill -0 "$model_pid" 2>/dev/null || exit 1
  elapsed=$((elapsed + 1))
  if [ "$elapsed" -ge 80 ]; then printf 'Model failed readiness.\n' >&2; exit 1; fi
  sleep 1
done

gosu node node /app/advice/private/public-pilot-server.mjs "$data" "https://$RAILWAY_PUBLIC_DOMAIN" "${PORT:-8080}" &
app_pid=$!
wait "$app_pid"
