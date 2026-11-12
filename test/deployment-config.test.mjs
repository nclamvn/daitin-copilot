import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateDeploymentConfig } from '../deploy/check-config.mjs';
import { loadDataset } from '../patents/dataset.mjs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
test('Vercel glob stays within schema limit and covers all pinned patent files plus PDF fonts/worker/native canvas', () => {
  const resources = loadDataset().sources.flatMap(source => [source.snapshot, source.textPath, source.ocrReceipt].filter(Boolean));
  resources.push('advice/ui/index.html', 'advice/ui/app.css', 'advice/ui/app.mjs',
    'patents/service.mjs', 'patents/ui/index.html', 'patents/ui/app.mjs', 'patents/data/catalog.json',
    'copilot/m4/pdf-js-worker.mjs', 'copilot/m4/brand/daitin-gray.png', 'copilot/evidence.sqlite',
    'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'node_modules/pdfjs-dist/standard_fonts/FoxitSerif.pfb',
    'node_modules/pdfjs-dist/cmaps/Adobe-Japan1-UCS2.bcmap', 'node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node');
  const result = validateDeploymentConfig(config, resources);
  assert.ok(result.includeLength <= 256);
  assert.ok(result.excludeLength <= 256);
  assert.ok(result.resources > 80);
  assert.throws(() => validateDeploymentConfig(config, ['work/accounts.json']));
  assert.throws(() => validateDeploymentConfig(config, ['work/daitin-m9-private/word.json']));
  assert.throws(() => validateDeploymentConfig(config, ['patents/data/secret.key']));
  const oversized = structuredClone(config); oversized.functions['api/index.mjs'].includeFiles = 'x'.repeat(257);
  assert.throws(() => validateDeploymentConfig(oversized));
  const missingWorker = structuredClone(config); missingWorker.functions['api/index.mjs'].includeFiles = '{patents/**,copilot/**}';
  assert.throws(() => validateDeploymentConfig(missingWorker, resources));
});
