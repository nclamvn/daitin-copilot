#!/bin/sh
set -eu
umask 077
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || [ "${VERCEL:-}" = 1 ]; then
  printf 'Cách dùng: sh %s THU_MUC_RIENG [WEB_PORT]\n' "$0" >&2
  exit 2
fi
repo=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
port=${2:-4342}
node "$repo/advice/private/prepare.mjs" "$1"
private_data=$(CDPATH='' cd -- "$1" && pwd -P)
unset DAI_TIN_MODEL_ENDPOINT
export DAI_TIN_ADVICE=1 DAI_TIN_ADVICE_MODE=private DAI_TIN_DATA_DIR="$private_data"
export DAI_TIN_BIND=127.0.0.1 DAI_TIN_WEB_TEST_HTTP=1 PORT="$port" DAI_TIN_PUBLIC_ORIGIN="http://127.0.0.1:$port"
export DAI_TIN_MODEL_MODE=disabled
exec node "$repo/distribution/start-web.mjs"
