#!/bin/sh
set -eu
app=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
runtime=${DAI_TIN_RUNTIME_DIR:-"$app/../../work/daitin-m2-runtime"}
runtime=$(CDPATH='' cd -- "$runtime" && pwd)
engine="$runtime/engine/llama-b12230/llama-server"
model="$runtime/qwen3-4b-instruct-2507-q4_k_m.gguf"
key="$runtime/engine.key"
[ -x "$engine" ] && [ -s "$model" ] && [ -s "$key" ] ||
  { echo 'Thiếu runtime. Chạy ./copilot/setup-m2.sh.' >&2; exit 2; }
export PORT=${PORT:-4312}
export DAI_TIN_MODEL_PORT=${DAI_TIN_MODEL_PORT:-4313}
export DAI_TIN_MODEL_ID=daitin-qwen3-4b-2507 DAI_TIN_MODEL_KEY_FILE="$key"
export DAI_TIN_CORPUS_MODE=preview DAI_TIN_COPILOT=1
for port in "$PORT" "$DAI_TIN_MODEL_PORT"; do
  case "$port" in ''|*[!0-9]*) echo 'Cổng cần là số.' >&2; exit 2;; esac
  [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || exit 2
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Cổng $port đang dùng." >&2
    exit 2
  fi
done
[ "$PORT" != "$DAI_TIN_MODEL_PORT" ] || exit 2
app_pid=
"$engine" --host 127.0.0.1 --port "$DAI_TIN_MODEL_PORT" --model "$model" --alias "$DAI_TIN_MODEL_ID" \
  --ctx-size 4096 --parallel 1 --n-gpu-layers 99 --no-ui --api-key-file "$key" --log-disable &
engine_pid=$!
cleanup() {
  [ -z "$app_pid" ] || kill "$app_pid" 2>/dev/null || true
  kill "$engine_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ready=0
for i in $(seq 1 30); do
  if curl -q -fsS --max-time 2 "http://127.0.0.1:$DAI_TIN_MODEL_PORT/health" >/dev/null 2>&1; then ready=1; break; fi
  kill -0 "$engine_pid" 2>/dev/null || break
  sleep 1
done
[ "$ready" -eq 1 ] || { echo 'Mô hình chưa sẵn sàng.' >&2; exit 2; }
cd "$app"
node server.mjs &
app_pid=$!
wait "$app_pid"
