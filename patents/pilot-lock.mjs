import { digest } from '../sot/bundle.mjs';

export const patentPDFRoles = Object.freeze(['notice', 'claim', 'd1']);
export const maxPatentPDFPages = 12;
export const maxPatentExcerptChars = 1800;
const maxTextOffset = 300000; // Both supported PDF engines bound the extracted UTF-8 text to 300,000 bytes.
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sourceKeys = ['sha256', 'page', 'start', 'end', 'textSha256'];
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function parsePilotLock(raw) {
  const invalid = () => new Error('Cấu hình khóa nguồn pilot không hợp lệ.');
  let lock = raw;
  if (typeof raw === 'string') {
    if (raw.length > 4096) throw invalid();
    try { lock = JSON.parse(raw); } catch { throw invalid(); }
  }
  if (!exactKeys(lock, ['version', 'manifestSha256', 'reference', 'asOf', 'sources']) || lock.version !== 1 ||
      !sha(lock.manifestSha256) || typeof lock.reference !== 'string' ||
      !/^[A-Z0-9][A-Z0-9./_-]{0,47}$/.test(lock.reference) || typeof lock.asOf !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(lock.asOf) || !exactKeys(lock.sources, patentPDFRoles)) throw invalid();
  const date = new Date(lock.asOf + 'T00:00:00Z');
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== lock.asOf) throw invalid();
  for (const role of patentPDFRoles) {
    const source = lock.sources[role];
    if (!exactKeys(source, sourceKeys) || !sha(source.sha256) || !sha(source.textSha256) ||
        !Number.isInteger(source.page) || source.page < 1 || source.page > maxPatentPDFPages ||
        !Number.isInteger(source.start) || !Number.isInteger(source.end) || source.start < 0 ||
        source.end <= source.start || source.end > maxTextOffset || source.end - source.start > maxPatentExcerptChars) throw invalid();
  }
  if (new Set(patentPDFRoles.map(role => lock.sources[role].sha256)).size !== patentPDFRoles.length) throw invalid();
  return { version: lock.version, manifestSha256: lock.manifestSha256, reference: lock.reference, asOf: lock.asOf,
    sources: Object.fromEntries(patentPDFRoles.map(role => [role, { ...lock.sources[role] }])) };
}

export const pilotLockDigest = lock => digest(parsePilotLock(lock));
export const matchesPilotSource = (value, approved) => Boolean(value && approved && sourceKeys.every(key => value[key] === approved[key]));
