#!/bin/sh
set -eu
app=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
runtime=${DAI_TIN_RUNTIME_DIR:-"$app/../../work/daitin-m2-runtime"}
mkdir -p "$runtime"
cd "$runtime"
[ "$(uname -m)" = arm64 ] || { echo 'Gói đã kiểm dành cho macOS Apple Silicon.' >&2; exit 2; }
model=qwen3-4b-instruct-2507-q4_k_m.gguf
engine_sha=036052dfc498919646abfa3635be73a0e1a5e740d8daf5322c73d2769f89aeff
model_sha=8cdb57cbb880d313736a9bc4e3d3d2485f145b5e19cf33783746e753e82641fc
check_hash() { printf '%s  %s\n' "$1" "$2" | shasum -a 256 -c -; }
if [ ! -s "$model" ] || [ ! -x engine/llama-b12230/llama-server ]; then
  free_kb=$(df -Pk . | awk 'NR==2 {print $4}')
  [ "$free_kb" -ge 10485760 ] || { echo 'Dừng vì dung lượng trống dưới 10 GiB.' >&2; exit 2; }
fi
trap 'rm -f engine.tar.gz.part "$model.part"' EXIT HUP INT TERM
if [ ! -x engine/llama-b12230/llama-server ]; then
  curl -q -fLsS --proto '=https' --proto-redir '=https' --max-time 60 --max-filesize 25000000 \
    'https://github.com/ggml-org/llama.cpp/releases/download/b12230/llama-b12230-bin-macos-arm64.tar.gz' -o engine.tar.gz.part
  check_hash "$engine_sha" engine.tar.gz.part
  mv engine.tar.gz.part engine.tar.gz
  mkdir -p engine
  tar -xzf engine.tar.gz -C engine
fi
if [ ! -s "$model" ]; then
  curl -q -fLsS --proto '=https' --proto-redir '=https' --max-time "${DAI_TIN_DOWNLOAD_TIMEOUT:-240}" --max-filesize 3100000000 \
    'https://huggingface.co/lmstudio-community/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf' -o "$model.part"
  check_hash "$model_sha" "$model.part"
  mv "$model.part" "$model"
fi
check_hash "$model_sha" "$model"
umask 077
[ -s engine.key ] || openssl rand -hex 32 > engine.key
printf '%s\n' 'Sẵn sàng chạy ./copilot/start-m2.sh'
