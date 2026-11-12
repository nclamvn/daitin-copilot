#!/bin/sh
set -eu
umask 077
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  printf 'Cách dùng: %s WORD.docx THU_MUC_RIENG [PORT]\n' "$0" >&2
  exit 2
fi
repo=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
python3 "$repo/advice/import-word.py" "$1" "$2/review.json" "$2/word.json"
private_data=$(CDPATH='' cd -- "$2" && pwd -P)
port=${3:-4339}
export DAI_TIN_ADVICE=1 DAI_TIN_ADVICE_MODE=word
export DAI_TIN_ADVICE_WORD="$private_data/word.json" DAI_TIN_ADVICE_REVIEW="$private_data/review.json"
export DAI_TIN_DATA_DIR="$private_data"
export DAI_TIN_BIND=127.0.0.1 DAI_TIN_WEB_TEST_HTTP=1 PORT="$port"
export DAI_TIN_PUBLIC_ORIGIN="http://127.0.0.1:$port" DAI_TIN_MODEL_MODE=disabled
exec node "$repo/distribution/start-web.mjs"
