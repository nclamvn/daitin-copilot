/** Candidate evidence registry. Deterministic retrieval never decides legal truth. */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH = /^[a-f0-9]{64}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const datasetDigest = dataset => { const { digest, ...body } = dataset; return sha(JSON.stringify(stable(body))); };
const fail = (kind, id = '') => { throw new Error(`PATENT_DATA_${kind}${id ? ':' + id : ''}`); };
const date = value => value === null || value === undefined || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
function checkedFile(root, relative, allowed) {
  if (typeof relative !== 'string' || !allowed.some(prefix => relative.startsWith(prefix)) || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').includes('..')) fail('PATH', relative);
  const full = path.resolve(root, relative);
  if (!realpathSync(full).startsWith(realpathSync(root) + path.sep)) fail('PATH_ESCAPE', relative);
  return readFileSync(full);
}
export function validateDataset(dataset, { appRoot = APP_ROOT } = {}) {
  dataset ??= JSON.parse(readFileSync(path.join(appRoot, 'patents/data/catalog.json'), 'utf8'));
  if (dataset.schemaVersion !== 1 || dataset.status !== 'candidate' || !Array.isArray(dataset.sources) || !Array.isArray(dataset.records) || !Array.isArray(dataset.gaps)) fail('SCHEMA');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(dataset.builtAt) || !Number.isFinite(Date.parse(dataset.builtAt))) fail('BUILD_DATE');
  if (!HASH.test(dataset.digest) || datasetDigest(dataset) !== dataset.digest) fail('DIGEST');
  const sourceById = new Map(), texts = new Map(), records = new Map(), claimSets = new Map();
  for (const source of dataset.sources) {
    if (!source.id || sourceById.has(source.id)) fail('SOURCE_ID', source.id);
    if (!['law','guidance','patent','commentary','policy'].includes(source.kind) || source.humanReview !== null || source.reviewStatus !== 'candidate_unreviewed') fail('SOURCE_REVIEW', source.id);
    if (!['VN','EP','US','INT'].includes(source.jurisdiction) || !source.authority || !source.title || !source.url?.startsWith('https://')) fail('SOURCE_METADATA', source.id);
    if (!date(source.publicationDate) || !date(source.priorityDate) || !date(source.applicationDate) || !date(source.effectiveFrom) || !date(source.effectiveTo) || (source.effectiveFrom && source.effectiveTo && source.effectiveFrom > source.effectiveTo)) fail('SOURCE_DATE', source.id);
    if (source.capturedAt !== null && (!source.capturedAt || !Number.isFinite(Date.parse(source.capturedAt)))) fail('CAPTURE_DATE', source.id);
    if (source.legalStatus !== null || source.family !== null) fail('UNVERIFIED_STATUS', source.id);
    if (!HASH.test(source.sha256) || sha(checkedFile(appRoot, source.snapshot, ['patents/data/snapshots/','corpus/snapshots/','copilot/snapshots/'])) !== source.sha256) fail('SOURCE_HASH', source.id);
    const rawText = checkedFile(appRoot, source.textPath, ['patents/data/extracts/']);
    if (!HASH.test(source.textSHA256) || sha(rawText) !== source.textSHA256) fail('TEXT_HASH', source.id);
    if (source.ocrReceipt) {
      const receiptBytes = checkedFile(appRoot, source.ocrReceipt, ['patents/data/extracts/']);
      if (sha(receiptBytes) !== source.ocrReceiptSHA256) fail('OCR_HASH', source.id);
      const receipt = JSON.parse(receiptBytes);
      if (receipt.sourceSHA256 !== source.sha256 || receipt.sourceId !== source.id || receipt.textFidelity !== 'ocr_unreviewed' || receipt.humanReview !== null) fail('OCR_PROVENANCE', source.id);
    }
    const extracted = rawText.toString('utf8');
    for (const page of source.pages ?? []) if (!Number.isInteger(page.page) || page.page < 1 || page.page > source.pageCount || !Number.isInteger(page.start) || !Number.isInteger(page.end) || page.start < 0 || page.end < page.start || page.end > extracted.length) fail('SOURCE_PAGE',source.id);
    sourceById.set(source.id, source); texts.set(source.id, extracted);
  }
  for (const record of dataset.records) {
    const source = sourceById.get(record.sourceId), locator = record.locator;
    if (!source || !record.id || records.has(record.id)) fail('RECORD_SOURCE_ID', record.id);
    if (record.humanReview !== null || !['law','guidance','patent','procedure','commentary'].includes(record.kind)) fail('RECORD_REVIEW', record.id);
    if (record.kind !== (source.kind === 'policy' ? 'procedure' : source.kind) || record.provenance !== (source.kind === 'commentary' ? 'secondary' : 'captured_primary') || record.jurisdiction !== source.jurisdiction) fail('AUTHORITY_PROMOTION', record.id);
    if (!date(record.effectiveFrom) || !date(record.effectiveTo) || !date(record.publicationDate) || !date(record.priorityDate) || (record.effectiveFrom && record.effectiveTo && record.effectiveFrom > record.effectiveTo)) fail('RECORD_DATE', record.id);
    if (!locator || !Number.isInteger(locator.start) || !Number.isInteger(locator.end) || locator.start < 0 || locator.end <= locator.start || locator.end > texts.get(source.id).length || !record.text?.trim() || texts.get(source.id).slice(locator.start, locator.end) !== record.text || sha(record.text) !== record.evidenceSHA256) fail('EXACT_SPAN', record.id);
    if (record.textFidelity === 'ocr_unreviewed' && !source.ocrReceipt) fail('OCR_MISSING', record.id);
    if (record.textFidelity === 'source_native_xml' && !source.snapshot.endsWith('.xml')) fail('FIDELITY', record.id);
    if (locator.page && (!Number.isInteger(locator.page) || locator.page < 1 || locator.page > source.pageCount)) fail('PAGE', record.id);
    if (record.claims) {
      if (source.kind !== 'patent' || record.claims.length !== 1 || !Number.isInteger(locator.claim)) fail('CLAIM_SCHEMA', record.id);
      const claim = record.claims[0];
      if (claim.number !== locator.claim || claim.text !== record.text || !Array.isArray(claim.dependencyReferences) || (claim.dependsOn !== null && (!Array.isArray(claim.dependsOn) || claim.dependsOn.some(n => !Number.isInteger(n) || n < 1 || n >= claim.number)))) fail('CLAIM_DEPENDENCY', record.id);
      const set = claimSets.get(source.id) ?? new Map();
      if (set.has(claim.number)) fail('CLAIM_DUPLICATE', record.id);
      set.set(claim.number, claim); claimSets.set(source.id, set);
    }
    records.set(record.id, record);
  }
  for (const [sourceId, claims] of claimSets) for (const claim of claims.values()) if (claim.dependsOn?.some(n => !claims.has(n))) fail('CLAIM_REFERENCE_MISSING', sourceId);
  return { valid: true, sources: dataset.sources.length, records: dataset.records.length, digest: dataset.digest, status: dataset.status };
}
let cached;
export function loadDataset() {
  if (!cached) {
    const dataset = JSON.parse(readFileSync(path.join(APP_ROOT, 'patents/data/catalog.json'), 'utf8'));
    validateDataset(dataset);
    const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };
    cached = freeze(dataset);
  }
  return cached;
}
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
const HINTS = [
 ['novelty', ['tinh moi','novelty']], ['inventive_step', ['trinh do sang tao','inventive step','non obvious']],
 ['claims', ['yeu cau bao ho','claims','claim']], ['amendment', ['sua doi','amendment','amend']],
 ['divisional', ['tach don','divisional']], ['disclosure', ['mo ta du','enablement','boc lo','disclosure']],
 ['priority', ['uu tien','priority']], ['classification', ['phan loai','classification','ipc','cpc']]
];
let searchIndex;
export function searchDataset({query = '', jurisdiction = 'VN', asOf = null, limit = 12} = {}) {
  const dataset = loadDataset(), q = normalize(query).trim();
  const base = { query: String(query).slice(0, 300), asOf, jurisdiction, dataStatus:'candidate', datasetDigest:dataset.digest, coverage:dataset.coverage, gaps:dataset.gaps, results:[] };
  if (!q || q.length > 300 || !['VN','EP','US','INT','ALL'].includes(jurisdiction) || !date(asOf)) return {...base,status:'needs_context',reason:'Provide a question of at most300characters, supported jurisdiction and an ISO date.'};
  if (asOf && asOf > dataset.coverage.checkedThrough) return {...base,status:'needs_context',reason:'Requested date is later than the captured corpus; no current-law assurance is available.'};
  searchIndex ??= dataset.records.map(record => {
    const source = dataset.sources.find(source => source.id === record.sourceId);
    return {record, source, body:normalize(record.text), title:normalize(`${record.title} ${source.title} ${source.publicationIdentifier ?? ''} ${record.id}`)};
  });
  const topics = HINTS.filter(([, values]) => values.some(value => q.includes(value))).map(([topic]) => topic);
  const stop = new Set(['cua','cho','cac','mot','voi','trong','the','and','for','luat','sang','che','viet','nam','toi','tim','tra','cuu','ve','co','la','khong','nhu','nao','can']);
  const tokens = [...new Set(q.split(/[^a-z0-9]+/).filter(token => token.length > 2 && !stop.has(token)))];
  const identifier = q.replace(/[^a-z0-9]/g,'').match(/(?:ep|us|vn)\d+[a-z]?\d*/)?.[0];
  const wantedClaim = q.match(/(?:claim|yeu cau bao ho)\s*(\d+)/)?.[1];
  const results = [];
  for (const entry of searchIndex) {
    const {record, source, body, title} = entry;
    // VN context includes foreign comparative sources, always with source jurisdiction.
    if (jurisdiction !== 'ALL' && jurisdiction !== 'VN' && source.jurisdiction !== jurisdiction && source.jurisdiction !== 'INT') continue;
    if (asOf && record.publicationDate && record.publicationDate > asOf) continue;
    let score = 0;
    for (const token of tokens) score += (title.includes(token) ? 3 : 0) + (body.includes(token) ? 1 : 0);
    if (body.includes(q)) score += 8;
    for (const topic of topics) { if (record.topics.includes(topic)) score += 10; if (source.topics?.includes(topic)) score += 12; const hint = HINTS.find(([key]) => key === topic); if (hint?.[1].some(term => normalize(source.title).includes(term))) score += 12; }
    const idMatch = identifier && normalize(source.publicationIdentifier).replace(/[^a-z0-9]/g,'').includes(identifier);
    if (identifier && !idMatch) continue;
    if (idMatch) score += 40;
    if (wantedClaim && record.locator.claim === Number(wantedClaim)) score += 25;
    if (score <= 0) continue;
    if (topics.length && ['law','guidance'].includes(record.kind)) score += 3;
    results.push({record,source,score,citation:{label:record.locator.label,url:source.url,page:record.locator.page,claim:record.locator.claim,sha256:source.sha256},
      applicability:'unresolved_requires_legal_review', comparative:source.jurisdiction !== jurisdiction && source.jurisdiction !== 'INT'});
  }
  results.sort((a,b) => b.score-a.score || a.record.id.localeCompare(b.record.id,'en'));
  // Keep a long document from hiding every alternative authority. Identifier
  // lookups remain exact publication searches and do not apply this cap.
  const counts = new Map();
  const diversified = identifier ? results : results.filter(item => {
    const count = counts.get(item.source.id) ?? 0; counts.set(item.source.id,count + 1); return count < 2;
  });
  return {...base,status:results.length?'results':'not_found',results:diversified.slice(0,Math.max(1,Math.min(25,Number.isInteger(limit)?limit:12))),
    retrievalMethod:'deterministic_lexical_with_assistant_curated_bilingual_hints',asOfDecision:'source_publication_filter_only_not_article_applicability'};
}
