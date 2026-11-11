#!/bin/sh
set -eu
app=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
pilot_dir=${DAI_TIN_M5_DIR:-"$app/../../work/daitin-m5"}
umask 077
mkdir -p "$pilot_dir"
export DAI_TIN_M5_ACCOUNTS=${DAI_TIN_M5_ACCOUNTS:-"$pilot_dir/accounts.json"}
export DAI_TIN_M3_STORE=${DAI_TIN_M3_STORE:-"$pilot_dir/local.sqlite"}
export DAI_TIN_M5=1 DAI_TIN_M4=1
export PORT=${PORT:-4320}
node --input-type=module - "$DAI_TIN_M5_ACCOUNTS" <<'JS'
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const file = process.argv[2];
const accounts = [
  { name: 'luat-su', role: 'reviewer', group: 'nhan-hieu' },
  { name: 'chuyen-vien', role: 'editor', group: 'nhan-hieu' },
  { name: 'nhom-khac', role: 'editor', group: 'kiem-thu' }
].map(item => ({ ...item, key: randomBytes(32).toString('hex') }));
try {
  writeFileSync(file, JSON.stringify(accounts, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
JS
printf 'Tài khoản pilot trong tệp riêng %s\n' "$DAI_TIN_M5_ACCOUNTS"
exec "$app/copilot/start-m3.sh"
