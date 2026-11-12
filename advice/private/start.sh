#!/bin/sh
set -eu
umask 077
if [ "$#" -lt 3 ] || [ "$#" -gt 5 ] || [ "${VERCEL:-}" = 1 ]; then
  printf 'Cách dùng: %s THU_MUC_RIENG LLAMA_SERVER MODEL_GGUF [WEB_PORT] [MODEL_PORT]\n' "$0" >&2
  exit 2
fi
repo=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
model=$(realpath "$3")
engine=$(realpath "$2")
port=${4:-4342}
model_port=${5:-9942}
if [ ! -x "$engine" ] || [ ! -r "$model" ]; then
  printf 'Cần engine llama-server và trọng số GGUF hiện có.\n' >&2
  exit 2
fi
node "$repo/advice/private/prepare.mjs" "$1"
private_data=$(CDPATH='' cd -- "$1" && pwd -P)
case "$private_data" in "$repo"|"$repo"/*) printf 'Kho phải nằm ngoài repo.\n' >&2; exit 2;; esac
export DAI_TIN_ADVICE_MODEL_SHA256
DAI_TIN_ADVICE_MODEL_SHA256=$(shasum -a 256 "$model" | cut -d ' ' -f 1)
model_id=$(basename "$model" .gguf)
"$engine" --host 127.0.0.1 --port "$model_port" --model "$model" --alias "$model_id" --api-key-file "$private_data/local-model.key" --ctx-size 8192 --parallel 1 --log-disable &
model_pid=$!
web_pid=''
cleanup() {
  if [ -n "$web_pid" ]; then kill "$web_pid" 2>/dev/null || true; fi
  kill "$model_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
attempt=0
until curl -fsS --max-time 1 "http://127.0.0.1:$model_port/health" >/dev/null 2>&1; do
  kill -0 "$model_pid" 2>/dev/null || exit 1
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 35 ]; then printf 'Model chưa sẵn sàng.\n' >&2; exit 1; fi
  sleep 1
done
kill -0 "$model_pid" 2>/dev/null || exit 1
unset DAI_TIN_MODEL_ENDPOINT
export DAI_TIN_ADVICE=1 DAI_TIN_ADVICE_MODE=private DAI_TIN_DATA_DIR="$private_data"
export DAI_TIN_BIND=127.0.0.1 DAI_TIN_WEB_TEST_HTTP=1 PORT="$port" DAI_TIN_PUBLIC_ORIGIN="http://127.0.0.1:$port"
export DAI_TIN_MODEL_MODE=enabled DAI_TIN_MODEL_PORT="$model_port" DAI_TIN_MODEL_ID="$model_id" DAI_TIN_MODEL_KEY_FILE="$private_data/local-model.key"
node "$repo/distribution/start-web.mjs" &
web_pid=$!
wait "$web_pid"
