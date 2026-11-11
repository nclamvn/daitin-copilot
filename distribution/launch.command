#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
PATH="/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'Bộ chạy này đã kiểm trên Mac dùng chip Apple Silicon. Mở Bản xem trước.html để xem ngay.'
  exit 2
fi
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; then
  echo 'Cần Node.js 24 trở lên. Xem mục Chuẩn bị máy trong HUONG-DAN.html.'
  open "$root/HUONG-DAN.html"
  exit 2
fi
for command in pdfinfo pdftotext pdftoppm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo 'Cần Poppler để đọc PDF. Xem mục Chuẩn bị máy trong HUONG-DAN.html.'
    open "$root/HUONG-DAN.html"
    exit 2
  fi
done
node "$root/app/distribution/check.mjs" "$root"
export DAI_TIN_RUNTIME_DIR="$root/runtime/model"
export DAI_TIN_M5_DIR="$root/runtime/pilot"
export DAI_TIN_M5_ACCOUNTS="$DAI_TIN_M5_DIR/accounts.json"
export DAI_TIN_M3_STORE="$DAI_TIN_M5_DIR/local.sqlite"
export DAI_TIN_DOWNLOAD_TIMEOUT=${DAI_TIN_DOWNLOAD_TIMEOUT:-1200}
if [ ! -s "$DAI_TIN_RUNTIME_DIR/qwen3-4b-instruct-2507-q4_k_m.gguf" ] ||
   [ ! -x "$DAI_TIN_RUNTIME_DIR/engine/llama-b12230/llama-server" ]; then
  echo 'Lần đầu sẽ tải mô hình cục bộ khoảng 2,5 GB và kiểm dấu tệp. Cần Internet và ít nhất 10 GB trống.'
  "$root/app/copilot/setup-m2.sh"
fi
node "$root/app/distribution/prepare-accounts.mjs" "$DAI_TIN_M5_DIR"
node "$root/app/distribution/seed.mjs" "$root" "$DAI_TIN_M3_STORE"
echo "Thông tin đăng nhập nằm trong $DAI_TIN_M5_DIR/THONG-TIN-DANG-NHAP.txt"
if [ "${DAI_TIN_OPEN_BROWSER:-1}" = 1 ]; then open -a TextEdit "$DAI_TIN_M5_DIR/THONG-TIN-DANG-NHAP.txt"; fi
exec "$root/app/copilot/start-desktop.sh"
