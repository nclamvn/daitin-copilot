import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateBundle } from '../sot/bundle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const officialHosts = new Set(['datafiles.chinhphu.vn', 'congbaocdn.chinhphu.vn', 'ipvietnam.gov.vn', 'www.ipvietnam.gov.vn']);

export function sourceManifest(appRoot = root) {
  const bundle = validateBundle(JSON.parse(readFileSync(resolve(appRoot, 'sot/candidate.json'), 'utf8')), 'preview');
  const copilot = JSON.parse(readFileSync(resolve(appRoot, 'copilot/sources.json'), 'utf8'));
  return [
    ...Object.entries(bundle.payload.registry.documents).map(([id, item]) => ({ ...item, id, storage: 'mvp', type: 'pdf' })),
    ...Object.values(copilot).filter(item => item.type === 'pdf')
  ];
}

// This allowlist only accepts public official manifests. Uploaded matter PDFs,
// mutable SQLite and working folders are never candidates for static serving.
export function verifiedSources(entries, appRoot = root) {
  const selected = new Map();
  for (const item of entries) {
    const url = new URL(item.url);
    if (item.type !== 'pdf' || !['mvp', 'copilot'].includes(item.storage) ||
        !/^[a-z0-9-]+$/.test(item.id ?? '') || !/^[a-z0-9-]+\.pdf$/.test(item.file ?? '') ||
        !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') || url.protocol !== 'https:' ||
        url.username || url.password || !officialHosts.has(url.hostname)) {
      throw new Error('Nguồn PDF không được phép xuất tĩnh.');
    }
    const directory = item.storage === 'mvp' ? 'corpus/snapshots' : 'copilot/snapshots';
    const bytes = readFileSync(resolve(appRoot, directory, item.file));
    if (!bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-') || sha256(bytes) !== item.sha256) {
      throw new Error('Dấu kiểm PDF không khớp: ' + item.id);
    }
    selected.set(item.sha256, { sha256: item.sha256, bytes });
  }
  return [...selected.values()];
}

export function stageSources({ appRoot = root, output = resolve(appRoot, 'dist'), entries = sourceManifest(appRoot) } = {}) {
  const sources = verifiedSources(entries, appRoot); // Validate all before touching previous build output.
  rmSync(output, { recursive: true, force: true });
  const destination = resolve(output, '__sources');
  mkdirSync(destination, { recursive: true });
  for (const item of sources) writeFileSync(resolve(destination, item.sha256 + '.pdf'), item.bytes);
  return { files: sources.length, bytes: sources.reduce((sum, item) => sum + item.bytes.length, 0) };
}

export function sourceRedirect(path, catalog, copilotManifest) {
  const source = path.match(/^\/sources\/([a-z0-9-]+)(?:\/([a-f0-9]{64}))?\.pdf$/);
  if (source) {
    const doc = catalog.documents.find(item => item.id === source[1]);
    if (!doc) return { status: 404 };
    if (source[2] && source[2] !== doc.sha256) return { status: 409 };
    return { status: 302, location: '/__sources/' + doc.sha256 + '.pdf' };
  }
  const copilot = path.match(/^\/copilot\/source\/([a-z0-9-]+)\.pdf$/);
  if (copilot) {
    const doc = Object.hasOwn(copilotManifest, copilot[1]) ? copilotManifest[copilot[1]] : null;
    if (doc?.type !== 'pdf' || !/^[a-f0-9]{64}$/.test(doc.sha256 ?? '')) return { status: 404 };
    return { status: 302, location: '/__sources/' + doc.sha256 + '.pdf' };
  }
  return null;
}
