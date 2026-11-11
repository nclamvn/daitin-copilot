import assert from 'node:assert/strict';
import { closeSync, openSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { blind, directory, loadCases } from './common.mjs';

const [mode, casesPath, outputPath, origin, accountsPath] = process.argv.slice(2);
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
