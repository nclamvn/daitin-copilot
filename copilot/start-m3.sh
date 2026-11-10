#!/bin/sh
set -eu
app=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
runtime=${DAI_TIN_RUNTIME_DIR:-"$app/../../work/daitin-m2-runtime"}
export PORT=${PORT:-4314}
export DAI_TIN_MODEL_PORT=${DAI_TIN_MODEL_PORT:-4313}
export DAI_TIN_MODEL_ID=${DAI_TIN_MODEL_ID:-daitin-qwen3-4b-2507}
export DAI_TIN_MODEL_KEY_FILE=${DAI_TIN_MODEL_KEY_FILE:-"$runtime/engine.key"}
export DAI_TIN_M3_STORE=${DAI_TIN_M3_STORE:-"$app/../../work/daitin-m3/local.sqlite"}
export DAI_TIN_CORPUS_MODE=preview DAI_TIN_COPILOT=1 DAI_TIN_PILOT=1 DAI_TIN_M3=1
export DAI_TIN_M4=${DAI_TIN_M4:-1}
if [ "$DAI_TIN_M4" = 1 ]; then
  for program in pdfinfo pdftotext pdftoppm; do
    command -v "$program" >/dev/null 2>&1 || { echo 'M4 cần Poppler để đọc PDF.' >&2; exit 2; }
  done
fi
if ! curl -q -fsS --max-time 2 "http://127.0.0.1:$DAI_TIN_MODEL_PORT/health" >/dev/null 2>&1; then
  echo 'Mô hình cục bộ chưa sẵn sàng. Khởi động pilot M2 trước.' >&2
  exit 2
fi
cd "$app"
exec node server.mjs
