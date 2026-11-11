#!/bin/sh
set -eu
app=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
runtime=${DAI_TIN_RUNTIME_DIR:-"$app/../../work/daitin-m2-runtime"}
export PORT=${PORT:-4320}
export DAI_TIN_MODEL_PORT=${DAI_TIN_MODEL_PORT:-4313}
export DAI_TIN_MODEL_ID=${DAI_TIN_MODEL_ID:-daitin-qwen3-4b-2507}
export DAI_TIN_MODEL_KEY_FILE=${DAI_TIN_MODEL_KEY_FILE:-"$runtime/engine.key"}
engine_pid=
app_pid=
cleanup() {
  [ -z "$app_pid" ] || kill "$app_pid" 2>/dev/null || true
  [ -z "$engine_pid" ] || kill "$engine_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! curl -q -fsS --max-time 2 "http://127.0.0.1:$DAI_TIN_MODEL_PORT/health" >/dev/null 2>&1; then
  engine="$runtime/engine/llama-b12230/llama-server"
  model="$runtime/qwen3-4b-instruct-2507-q4_k_m.gguf"
  [ -x "$engine" ] && [ -s "$model" ] && [ -s "$DAI_TIN_MODEL_KEY_FILE" ] ||
    { echo 'Thiếu mô hình cục bộ của pilot. Cần khôi phục runtime M2.' >&2; exit 2; }
  echo 'Đang mở mô hình Đại Tín trên máy…'
  "$engine" --host 127.0.0.1 --port "$DAI_TIN_MODEL_PORT" --model "$model" --alias "$DAI_TIN_MODEL_ID" \
    --ctx-size 4096 --parallel 1 --n-gpu-layers 99 --no-ui --api-key-file "$DAI_TIN_MODEL_KEY_FILE" --log-disable &
  engine_pid=$!
  ready=0
  for attempt in $(seq 1 45); do
    if curl -q -fsS --max-time 2 "http://127.0.0.1:$DAI_TIN_MODEL_PORT/health" >/dev/null 2>&1; then ready=1; break; fi
    kill -0 "$engine_pid" 2>/dev/null || break
    sleep 1
  done
  [ "$ready" = 1 ] || { echo 'Chưa mở được mô hình cục bộ.' >&2; exit 2; }
fi

status=$(curl -q -s --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/m5/status" || true)
if [ "$status" != 401 ] && [ "$status" != 200 ]; then
  "$app/copilot/start-m5.sh" &
  app_pid=$!
  ready=0
  for attempt in $(seq 1 30); do
    status=$(curl -q -s --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/m5/status" || true)
    if [ "$status" = 401 ] || [ "$status" = 200 ]; then ready=1; break; fi
    kill -0 "$app_pid" 2>/dev/null || break
    sleep 1
  done
  [ "$ready" = 1 ] || { echo 'Chưa mở được Bàn hồ sơ.' >&2; exit 2; }
fi
url="http://127.0.0.1:$PORT/copilot/m3/workspace/"
echo "Bàn hồ sơ đã sẵn sàng tại $url"
echo 'Giữ cửa sổ này mở khi dùng Đại Tín. Bấm Ctrl+C để dừng.'
if [ "${DAI_TIN_OPEN_BROWSER:-1}" = 1 ]; then open "$url"; fi
if [ -n "$app_pid" ]; then wait "$app_pid"
elif [ -n "$engine_pid" ]; then wait "$engine_pid"
fi
