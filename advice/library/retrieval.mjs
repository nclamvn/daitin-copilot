import { createHash } from 'node:crypto';
import { followUp, mentionsPoa, normalize, poaIntents } from './poa.mjs';

const facet = [
  { vn: /\b(viet nam|vietnam|vn)\b/, th: /\b(thai lan|thailand|thai|th)\b/, sg: /\b(singapore|sg)\b/, my: /\b(malaysia)\b/ },
  { tm: /\b(nhan hieu|trademark|trade mark)\b/, pt: /\b(sang che|patents?|bang doc quyen sang che)\b/, ds: /\b(kieu dang|design)\b/ },
  { renew: /\b(gia han|renewal|renew|renewing|to renew)\b/, annuity: /\b(nien phi|phi duy tri|duy tri|annuity|annuities|annual fees?|maintenance fees?)\b/,
    filing: /\b(nop don|dang ky moi|don moi|filing|new application|tiep nhan don|chuan bi don|dang ky kieu dang|dang ky nhan hieu)\b/,
    change: /\b(doi ten|doi chu|thay doi chu|ghi nhan thay doi|change of name|name change|name recordal)\b/,
    pct: /\b(pct|giai doan quoc gia|national phase)\b/ },
  { poa: { test: mentionsPoa },
    documents: /\b(tai lieu|giay to|checklist|documents|bieu mau|to khai|mau nao|mau so|form|giay gi|gui gi|can gui|danh muc ho so|ho so gom|chuan bi gi|can nhung gi|thong tin gi)\b/,
    deadline: /\b(thoi han|han nop|nop tre|nop muon|bao lau|grace|deadline|late payment|may thang)\b/,
    fee: /\b(bao gia|bieu phi|muc phi|bao nhieu tien|chi phi|le phi|cost|price|quotation)\b/ },
];
const stop = new Set('a an is in of the to for co cho theo tai can va cua khi ho so dang voi thi duoc xin nay mot neu'.split(' '));
const permittedLayers = ['library', 'word', 'updated', 'conflict'];
const tokens = text => normalize(text).split(' ').filter(token => token.length > 1 && !stop.has(token));
const fileHash = /^[a-f0-9]{64}$/;

export const labels = [
  { vn: 'Việt Nam', th: 'Thái Lan', sg: 'Singapore', my: 'Malaysia' },
  { tm: 'nhãn hiệu', pt: 'sáng chế', ds: 'kiểu dáng' },
  { renew: 'gia hạn', annuity: 'nộp niên phí', filing: 'nộp đơn', change: 'ghi nhận đổi tên', pct: 'vào giai đoạn quốc gia PCT' },
  { poa: 'giấy ủy quyền (POA)', documents: 'tài liệu cần chuẩn bị', deadline: 'thời hạn', fee: 'chi phí' },
];

export function validScope(scope) {
  return Array.isArray(scope) && scope.length === facet.length &&
    scope.every((value, i) => typeof value === 'string' && Object.hasOwn(facet[i], value));
}

export function scopeOf(query, previous) {
  const input = normalize(query);
  if (/\b(utility model|giai phap huu ich|khieu nai|infringement|opposition|phan doi|tranh chap|chuyen nhuong|assignment|tham dinh|indonesia|philippines|japan|nhat ban|china|trung quoc|korea|han quoc)\b/.test(input)) return null;
  const scope = facet.map(group => Object.entries(group).filter(([, expression]) => expression.test(input)).map(([key]) => key));
  if (scope[2].includes('annuity') && /\b(duy tri|nien phi|annuity|annuities|maintenance fees?)\b/.test(input) &&
      /\b(gia han hieu luc bang|renew(al|ing)? (a |the )?patent)\b/.test(input)) {
    scope[2] = scope[2].filter(value => value !== 'renew');
  }
  // A renewal question can mention the trademark registration being renewed.
  if (scope[2].includes('renew') && !/\b(nop don|dang ky moi|don moi|filing|new application)\b/.test(input)) {
    scope[2] = scope[2].filter(value => value !== 'filing');
  }
  if (scope[3].includes('poa') && !/\b(va|and|also|them|dong thoi)\b/.test(input)) {
    scope[3] = scope[3].filter(value => value !== 'documents');
  }
  if (scope.every(values => values.length === 1)) return scope.map(([value]) => value);
  const unidentifiedPlace = !scope[0].length && /\b(o|tai|in|at) [a-z]/.test(input.replace(/^in that case /, ''));
  if (validScope(previous) && previous[3] === 'poa' && followUp(input) && !unidentifiedPlace &&
      !/\b((o|tai|in) (nuoc|thi truong|quoc gia) khac|another country|khac thi sao)\b/.test(input) &&
      (mentionsPoa(input) || poaIntents(input)[0] !== 'requirement') &&
      scope.every((values, i) => !values.length || (values.length === 1 && values[0] === previous[i]))) return [...previous];
  return null;
}

const dateLike = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(value + 'T00:00:00Z').toJSON()?.slice(0, 10) === value;

export function createIndex(bundle, { privateLibrary = false } = {}) {
  if (bundle?.schema !== 1 || bundle.simulation !== !privateLibrary || !Array.isArray(bundle.rows) ||
      (!privateLibrary && !bundle.rows.length) || bundle.rows.length > 20000) throw new Error('Kho diễn tập chưa hợp lệ.');
  const rows = new Map();
  const postings = new Map();
  const scopes = new Map();
  for (const row of bundle.rows) {
    if (!/^[a-z0-9-]{1,80}$/.test(row.id) || rows.has(row.id) || !['word', 'email'].includes(row.kind) ||
        row.simulated !== !privateLibrary || typeof row.reviewed !== 'boolean' || !/^[a-z0-9-]{1,50}$/.test(row.issuer) ||
        !Array.isArray(row.scope) || row.scope.length !== 4 || !row.scope.every((value, i) => Object.hasOwn(facet[i], value)) ||
        typeof row.quote !== 'string' || row.quote.length < 12 || row.quote.length > 2500 ||
        typeof row.title !== 'string' || typeof row.value !== 'string' ||
        !/^[a-z0-9-]{1,90}\.(docx|eml)$/.test(row.file) || row.file.endsWith('.docx') !== (row.kind === 'word') ||
        !Number.isSafeInteger(row.paragraph) || row.paragraph < 1 || !fileHash.test(row.sha256) ||
        createHash('sha256').update(row.quote).digest('hex') !== row.quoteSha256 ||
        !Array.isArray(row.layers) || !row.layers.every(layer => permittedLayers.includes(layer)) ||
        !Array.isArray(row.supersedes) || !row.supersedes.every(value => typeof value === 'string') ||
        !(row.date === null || dateLike(row.date))) throw new Error('Đoạn chưa khóa hoặc có metadata không hợp lệ.');
    rows.set(row.id, row);
    const key = row.scope.join('/');
    if (!scopes.has(key)) scopes.set(key, []);
    scopes.get(key).push(row);
    for (const token of new Set(tokens(row.title + ' ' + row.quote))) {
      if (!postings.has(token)) postings.set(token, []);
      postings.get(token).push(row.id);
    }
  }
  for (const row of rows.values()) for (const id of row.supersedes) {
    const old = rows.get(id);
    if (!old || id === row.id || row.kind !== 'email' || !row.date || old.issuer !== row.issuer ||
        old.scope.join('/') !== row.scope.join('/') || (old.date && row.date <= old.date)) {
      throw new Error('Quan hệ thay thế sai phạm vi, đơn vị xác nhận hoặc thứ tự thời gian.');
    }
  }
  function ranked(query) {
    const scores = new Map();
    for (const token of new Set(tokens(query))) {
      const hits = postings.get(token) ?? [];
      const weight = Math.log(1 + rows.size / (1 + hits.length));
      for (const id of hits) scores.set(id, (scores.get(id) ?? 0) + weight);
    }
    return scores;
  }
  function search(query, scenario, limit = 8) {
    const scores = ranked(query);
    return [...scores].filter(([id]) => rows.get(id).layers.includes(scenario))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([id]) => rows.get(id));
  }
  function retrieve(query, scenario, previous) {
    const scope = scopeOf(query, previous);
    if (!scope) return { scope: null, active: [], context: [], replaced: [], supplemental: [] };
    const matches = (scopes.get(scope.join('/')) ?? []).filter(row => row.reviewed && row.layers.includes(scenario));
    const replacedIds = new Set(matches.flatMap(row => row.supersedes));
    const scores = ranked(query);
    const sort = (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || a.id.localeCompare(b.id);
    const active = matches.filter(row => !replacedIds.has(row.id)).sort(sort);
    const context = active.length ? [] : search(query, scenario, 16).filter(row =>
      row.reviewed && row.scope[0] === scope[0] && row.scope[1] === scope[1] && row.scope[3] === scope[3]).slice(0, 2);
    let supplemental = [];
    if (scope[3] === 'documents' && active.length) {
      const poaScope = [...scope.slice(0, 3), 'poa'].join('/');
      const poa = (scopes.get(poaScope) ?? []).filter(row => row.reviewed && row.layers.includes(scenario));
      const superseded = new Set(poa.flatMap(row => row.supersedes));
      const current = poa.filter(row => !superseded.has(row.id)).sort(sort);
      if (new Set(current.map(row => row.value)).size === 1) supplemental = current.slice(0, 2);
    }
    return { scope, active, context, supplemental, replaced: matches.filter(row => replacedIds.has(row.id)).sort(sort) };
  }
  return { search, retrieve, source: id => rows.get(id)?.reviewed ? rows.get(id) : null, documents: new Set(bundle.rows.map(row => row.file)).size, size: rows.size };
}
