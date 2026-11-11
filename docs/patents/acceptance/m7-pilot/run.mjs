import assert from 'node:assert/strict';
import { closeSync, lstatSync, openSync, realpathSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { blind, directory, loadCases } from './common.mjs';

const [mode, casesPath, outputPath, origin, accountsPath] = process.argv.slice(2);
if (mode === 'validate-human' || mode === 'human-direct') {
  try { await humanCommand(); }
  catch (error) {
    console.error(error?.constructor?.name === 'HumanPilotError' ? error.message :
      'Thiếu cấu hình, tệp không khớp manifest hoặc thư mục riêng chưa sẵn sàng. Kiểm tra hướng dẫn human-direct.');
    process.exitCode = 1;
  }
} else {
  await automatedCommand();
}

async function humanCommand() {
  const { HumanPilotError } = await import('./direct-human.mjs');
  const checkout = fileURLToPath(new URL('../../../../', import.meta.url));
  const isOutside = path => !resolve(path).startsWith(resolve(checkout) + sep) && resolve(path) !== resolve(checkout);
  if (!casesPath || !isOutside(realpathSync(casesPath))) throw new HumanPilotError('Đặt manifest đã duyệt ngoài checkout Git.');
  const input = loadCases(casesPath, 8, { anonymized: true });
  if (mode === 'validate-human') {
    const { verifyHumanSources } = await import('./direct.mjs');
    const documents = await verifyHumanSources(input);
    console.log(JSON.stringify({ cases: input.cases.length, documents, manifestSha256: input.manifestSha256, modelCalls: 0 }));
    return;
  }
  if (!outputPath || !['1', '2'].includes(origin) || accountsPath || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new HumanPilotError('Dùng terminal tương tác: node run.mjs human-direct CASES.json OUTPUT_DIR 1|2');
  }
  if (process.env.DAITIN_PILOT_LIVE !== '1' || process.env.DAI_TIN_PILOT_AUTHORIZED_ANONYMIZED !== '1') {
    throw new HumanPilotError('Chỉ chạy sau khi bộ nguồn đã được phép dùng với Gateway và đã bật hai biến pilot.');
  }
  if (!isOutside(resolve(outputPath))) throw new HumanPilotError('Đặt thư mục kết quả ngoài checkout Git.');
  const out = realpathSync(directory(resolve(outputPath)));
  const stats = lstatSync(out);
  if (!isOutside(out) || !stats.isDirectory() || (stats.mode & 0o077) || stats.uid !== process.getuid?.()) {
    throw new HumanPilotError('Thư mục kết quả phải do người vận hành sở hữu, quyền 0700, ngoài checkout Git.');
  }
  const lock = join(out, 'direct.lock');
  const descriptor = openSync(lock, 'wx', 0o600);
  const io = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const { runHumanDirect } = await import('./direct.mjs');
    await runHumanDirect({ out, input, phase: Number(origin), ask: prompt => io.question(prompt) });
  } finally {
    io.close();
    closeSync(descriptor);
    unlinkSync(lock);
  }
}

async function automatedCommand() {
  if (!['validate', 'product-prepare', 'product', 'direct', 'blind', 'summary'].includes(mode) || !casesPath || !outputPath) {
    throw new Error('Usage: node run.mjs validate|product-prepare|product|direct|blind|summary CASES.json OUTPUT_DIR [ORIGIN ACCOUNTS.json]');
  }
  const out = directory(resolve(outputPath));
  const limit = Number(process.env.DAITIN_PILOT_LIMIT ?? '8');
  assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 8);
  const input = loadCases(casesPath, limit);
  if (mode === 'validate') {
    console.log(JSON.stringify({ cases: input.cases.length, manifestSha256: input.manifestSha256, modelCalls: 0 }));
  } else if (mode === 'summary') {
    assert.equal(limit, 8, 'Summary requires all eight cases in its denominator');
    const { summarize } = await import('./summarize.mjs');
    console.log(JSON.stringify(summarize(out, input)));
  } else if (mode === 'blind') {
    assert.equal(limit, 8, 'Blind pack requires all eight cases in its denominator');
    console.log(JSON.stringify(blind(out, input)));
  } else {
    if (mode !== 'product-prepare') assert.equal(process.env.DAITIN_PILOT_LIVE, '1', 'Explicitly enable the live pilot');
    const lock = join(out, (mode.startsWith('product') ? 'product' : mode) + '.lock');
    const descriptor = openSync(lock, 'wx', 0o600);
    try {
      if (mode === 'direct') {
        const { runDirect } = await import('./direct.mjs');
        await runDirect({ out, input });
      } else {
        assert.ok(origin && accountsPath, 'Product arm requires origin and account file');
        const { runProduct } = await import('./product.mjs');
        await runProduct({ out, input, origin, accountsPath, prepareOnly: mode === 'product-prepare' });
      }
    } finally {
      closeSync(descriptor);
      unlinkSync(lock);
    }
  }
}
