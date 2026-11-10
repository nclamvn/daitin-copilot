import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadSot } from './sot/bundle.mjs';

const mode = process.env.DAI_TIN_CORPUS_MODE;
const bundle = mode === undefined ? null : loadSot(mode);
const corpus = bundle?.payload.registry ??
  JSON.parse(readFileSync(new URL('./corpus/vn-trademark.json', import.meta.url), 'utf8'));
const { release, coveredFrom, checkedThrough, cutover, cutoverBasis, boundaryBasis = [], procedures, provisions, forms, documents } = corpus;
const officialHosts = new Set(['datafiles.chinhphu.vn', 'congbaocdn.chinhphu.vn', 'ipvietnam.gov.vn']);

export const snapshots = new Map();

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function has(object, key) {
  return typeof key === 'string' && Object.hasOwn(object, key);
}

function verifyCorpus() {
  for (const [id, doc] of Object.entries(documents)) {
    const link = new URL(doc.url);
    if (link.protocol !== 'https:' || !officialHosts.has(link.hostname) || !/^[a-z0-9-]+\.pdf$/.test(doc.file)) {
      throw new Error('Nguồn không được chấp nhận: ' + id);
    }
    const bytes = readFileSync(new URL('./corpus/snapshots/' + doc.file, import.meta.url));
    if (createHash('sha256').update(bytes).digest('hex') !== doc.sha256) {
      throw new Error('Dấu kiểm nguồn không khớp: ' + id);
    }
    snapshots.set(id, bytes);
  }

  for (const [id, item] of Object.entries({ ...provisions, ...forms })) {
    if (!has(documents, item.document) || !Number.isInteger(item.page) || item.page < 1 || item.page > documents[item.document].pages) {
      throw new Error('Vị trí nguồn không hợp lệ: ' + id);
    }
    if (!isDate(item.from) || (item.until && (!isDate(item.until) || item.until <= item.from))) {
      throw new Error('Mốc hiệu lực không hợp lệ: ' + id);
    }
    if (item.basis?.some(basis => !has(provisions, basis))) throw new Error('Thiếu căn cứ: ' + id);
  }

  for (const procedure of Object.values(procedures)) {
    if (procedure.versions.some(id => !has(forms, id)) || procedure.basis?.some(id => !has(provisions, id))) {
      throw new Error('Thủ tục thiếu nguồn');
    }
    procedure.versions.forEach((id, index, versions) => {
      const form = forms[id];
      const next = versions[index + 1];
      const expectedUntil = next ? forms[next].from : undefined;
      if (form.until !== expectedUntil || form.successor !== next || (index === 0 && form.from !== coveredFrom)) {
        throw new Error('Dải phiên bản bị hở hoặc chồng lấn: ' + id);
      }
    });
  }
}

verifyCorpus();

function displayDate(value) {
  return value.split('-').reverse().join('/');
}

function docLinks(id, page) {
  const doc = documents[id];
  return {
    document: doc.number,
    documentTitle: doc.label,
    kind: doc.kind,
    authority: doc.authority,
    page,
    originalUrl: doc.url + '#page=' + page,
    snapshotUrl: '/sources/' + id + '.pdf#page=' + page,
    sha256: doc.sha256
  };
}

function applicability(item, on) {
  if (on < coveredFrom || on > checkedThrough) return 'unchecked';
  if (on < item.from) return 'future';
  return item.until && on >= item.until ? 'historical' : 'applicable';
}

function evidence(id, on) {
  const item = provisions[id];
  return {
    id, locator: item.locator, title: item.title, summary: item.summary,
    quote: item.quote ?? null, from: item.from, until: item.until ?? null,
    status: applicability(item, on), ...docLinks(item.document, item.page)
  };
}

function formView(id, effectiveOn, checkedOn) {
  const item = forms[id];
  return {
    id, title: item.title, number: item.number, appendix: item.appendix,
    from: item.from, until: item.until ?? null, successor: item.successor ?? null,
    status: applicability(item, effectiveOn ?? checkedOn),
    editionStatus: applicability(item, checkedOn),
    ...docLinks(item.document, item.page)
  };
}

export function getCatalog() {
  const procedureOrder = bundle?.payload.coverage.map(row => row.procedure) ?? Object.keys(procedures);
  return {
    release, coveredFrom, checkedThrough, cutover,
    dataStatus: mode ?? 'legacy', releaseDigest: bundle?.digest ?? null,
    procedures: procedureOrder.map(id => ({ id, label: procedures[id].label })),
    documents: Object.keys(documents).map(id => ({ id, ...docLinks(id, 1) }))
  };
}

export function getEvidence(id) {
  return has(provisions, id) ? evidence(id, checkedThrough) : null;
}

function normalize(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const stopwords = new Set('toi muon can cho xin xem biet la cua tai tu den va co nao khi duoc ve hay bao voi ho so nhan hieu viet nam'.split(' '));
const normalizeTerms = terms => terms.map(normalize);
const provisionTerms = Object.fromEntries(Object.entries(provisions).map(([id, row]) => [id, normalizeTerms(row.terms)]));
const procedureTerms = Object.fromEntries(Object.entries(procedures).map(([id, row]) => [id, normalizeTerms(row.terms)]));
const matches = (text, term) => (' ' + text + ' ').includes(' ' + term + ' ');
const externalScope = /\b(madrid|wipo|pct|sang che|kieu dang|ban quyen|quyen tac gia|singapore|thai lan|malaysia|campuchia|indonesia|philippines|hoa ky|trung quoc|nhat ban|han quoc|chau au|eu|uspto|euipo|my|lao|uc|anh quoc|nuoc ngoai|quoc te|international|china|japan|korea|thailand|patent|copyright)\b/;
const highRiskIntent = /\b(tinh han|bao lau|thoi han|han cuoi|qua han|het han|mat quyen|phi|le phi|bao nhieu|chi phi|bao ho duoc khong|kha nang dang ky|co dang ky duoc|xam pham|tranh chap|tra cuu trung|doi chung|tinh trang don|da cap chua|dang xu ly den dau|deadline|fee|cost|infringement|how long|how much|how many|expiration|expired|validity of my|case status|application status)\b/;

export function search(query, on = checkedThrough) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300 || !isDate(on)) {
    throw new InputError('Nhập câu hỏi tối đa 300 ký tự và ngày đối chiếu hợp lệ.');
  }
  const normalized = normalize(query);
  const common = { release, on };
  if (externalScope.test(normalized)) {
    return { ...common, status: 'out_of_scope', procedure: null, hits: [], message: 'Bản này chỉ tra nhãn hiệu theo tuyến quốc gia tại Việt Nam.' };
  }

  const explicitArticle = normalized.match(/\bdieu (\d{1,4})([a-z])?\b/);
  const explicitDoc = normalized.match(/\b(\d{1,3}) (\d{4}) tt bkhcn\b/) ??
    normalized.match(/\b(?:thong tu(?: so)?|tt) (\d{1,3}) (\d{4})\b/) ??
    query.trim().match(/^(\d{1,3})\s*\/\s*(\d{4})$/);
  const baseLaw = /\b(luat so huu tri tue|luat shtt|160 2026 vbhn|vbhn 160)\b/.test(normalized);
  const lawAmendment = /\b131 2025 qh15\b/.test(normalized);
  const consolidatedRules = /\b(06 vbhn bkhcn|vbhn 06)\b/.test(normalized);
  const guidance = /\b(thong bao (?:so )?4863|4863 tb shtt)\b/.test(normalized);
  const requestedSource = lawAmendment || baseLaw ? 'vbhn160' : consolidatedRules ? 'vbhn06' : guidance ? 'notice4863' : null;
  const otherLaw = [...normalized.matchAll(/\b(\d+) (\d{4}) qh(\d+)\b/g)]
    .some(item => !['131/2025/15', '50/2005/11'].includes(item.slice(1).join('/')));
  const unsupportedInstrument = /\b(nghi dinh|\d{4} nd cp)\b/.test(normalized) ||
    otherLaw || (!requestedSource && /\b(luat so \d+|\d{4} qh\d+)\b/.test(normalized));
  if (!explicitDoc && (unsupportedInstrument || (requestedSource && !has(documents, requestedSource)))) {
    return { ...common, status: 'not_found', procedure: null, hits: [], message: 'Văn bản được hỏi chưa có trong bản dữ liệu này.' };
  }
  const requestedDocument = explicitDoc ? explicitDoc[1] + '/' + explicitDoc[2] + '/TT-BKHCN' : null;
  const requestedPoint = normalized.match(/\bdiem ([a-z])\b/)?.[1];
  const requestedClause = normalized.match(/\bkhoan (\d{1,3})\b/)?.[1];
  let candidateProcedures = Object.entries(procedureTerms)
    .filter(([, terms]) => terms.some(term => matches(normalized, term))).map(([id]) => id);
  if (candidateProcedures.length > 1) candidateProcedures = candidateProcedures.filter(id => id !== 'registration');
  if (candidateProcedures.includes('office_response') && candidateProcedures.includes('application_amendment')) {
    candidateProcedures = candidateProcedures.filter(id => id !== 'application_amendment');
  }
  const suggested = candidateProcedures.length === 1 ? candidateProcedures[0] : null;
  const tokens = normalized.split(' ').filter(token => token.length >= 3 && !stopwords.has(token));
  const scored = Object.entries(provisions)
    .filter(([id, item]) => !requestedSource || explicitDoc || (item.document === requestedSource &&
      (requestedSource !== 'vbhn160' || (lawAmendment ? id.startsWith('law131-') : id.startsWith('law-')))))
    .filter(([, item]) => !requestedDocument || documents[item.document].number === requestedDocument ||
      (requestedDocument === '10/2026/TT-BKHCN' && item.amendsArticle === Number(explicitArticle?.[1])))
    .map(([id, item]) => {
      if (explicitArticle) {
        const requested = Number(explicitArticle[1]);
        const amended = item.amendsArticle === requested;
        const articleMatches = !explicitArticle[2] && (item.article === requested || amended);
        const clause = amended ? item.amendedClause : item.clause;
        const point = amended ? item.amendedPoint : item.point;
        const clauseMatches = !requestedClause || clause === requestedClause || item.clauses?.includes(requestedClause);
        const pointMatches = !requestedPoint || point === requestedPoint;
        return [id, articleMatches && clauseMatches && pointMatches ? 10 : 0];
      }
      const terms = provisionTerms[id];
      const phrases = terms.filter(term => matches(normalized, term)).length;
      const overlap = new Set(tokens.filter(token => terms.some(term => term.split(' ').includes(token)))).size;
      return [id, phrases * 5 + (overlap >= 2 ? overlap : 0) + (requestedDocument || requestedSource ? 1 : 0)];
    })
    .filter(([, score]) => score > 0)
    .sort((a, b) => {
      const active = id => applicability(provisions[id], on) === 'applicable' ? 1 : 0;
      return b[1] - a[1] || active(b[0]) - active(a[0]);
    });
  const hits = scored.slice(0, 6).map(([id]) => evidence(id, on));
  const requiresReview = highRiskIntent.test(normalized);
  const procedure = !explicitArticle && !requestedDocument && !requestedSource && !requiresReview ? suggested : null;
  const status = requiresReview ? 'needs_review' : (hits.length || procedure ? 'found' : 'not_found');
  const message = requiresReview ? 'Câu hỏi cần rà soát riêng. Dưới đây là căn cứ liên quan có trong bản dữ liệu.'
    : status === 'found' ? 'Chọn căn cứ để mở đúng vị trí hoặc xác nhận thủ tục để đối chiếu mẫu.'
      : 'Chưa tìm thấy điều khoản trong bản dữ liệu này. Thử nhập số điều, số hiệu hoặc tên thủ tục.';
  return { ...common, status, procedure, hits, message };
}

export class InputError extends Error {}

export function resolveProcedure(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Dữ kiện hồ sơ không hợp lệ.');
  const { procedure, mode, asOf, receivedOn = null, pendingAtCutover = null } = input;
  if (!has(procedures, procedure) || !['prepare', 'case'].includes(mode) || !isDate(asOf) ||
      (receivedOn !== null && !isDate(receivedOn)) || ![null, true, false].includes(pendingAtCutover)) {
    throw new InputError('Chọn thủ tục, chế độ và nhập ngày hợp lệ.');
  }
  if (mode === 'prepare' && (receivedOn !== null || pendingAtCutover !== null)) {
    throw new InputError('Chế độ chuẩn bị hồ sơ chỉ dùng ngày dự kiến nộp.');
  }
  if (receivedOn && receivedOn > asOf) throw new InputError('Ngày tiếp nhận phải bằng hoặc trước ngày đối chiếu.');

  const spec = procedures[procedure];
  const context = { procedure, label: spec.label, mode, asOf, receivedOn, pendingAtCutover, cutover };
  const common = { release, context, checkedThrough, coveredFrom };
  const result = (status, rule, title, explanation, extra = {}) => ({
    ...common, status, rule, title, explanation, missing: [],
    applicableOn: null, form: null, versions: [], citations: [], ...extra
  });
  const cite = (ids, on = asOf) => [...new Set(ids)].map(id => evidence(id, on));
  const transitionIds = [cutoverBasis.transition, cutoverBasis.effective];
  if (asOf < coveredFrom || asOf > checkedThrough || (receivedOn && receivedOn < coveredFrom)) {
    const earlier = asOf < coveredFrom || (receivedOn && receivedOn < coveredFrom);
    const citations = earlier ? cite(boundaryBasis.filter(id =>
      documents[provisions[id].document].kind !== 'Thông báo nghiệp vụ' || provisions[id].from <= asOf)) : [];
    return result('out_of_coverage', 'coverage', 'Ngày nằm ngoài phạm vi đã kiểm',
      'Bản dữ liệu này hỗ trợ từ ' + displayDate(coveredFrom) + ' đến ' + displayDate(checkedThrough) +
      '. Cần đối chiếu nguồn ở đúng thời điểm trước khi chọn mẫu.', { citations });
  }

  if (mode === 'case' && !receivedOn) {
    return result('needs_context', 'missing_date', 'Cần ngày tiếp nhận',
      'Nhập ngày cơ quan có thẩm quyền tiếp nhận đúng đơn hoặc yêu cầu đang tra.',
      { missing: ['receivedOn'] });
  }

  const crossesCutover = mode === 'case' && receivedOn < cutover && asOf >= cutover;
  if (crossesCutover && pendingAtCutover === null) {
    return result('needs_context', 'missing_pending', 'Hồ sơ còn đang giải quyết tại mốc 01/07/2026?',
      'Điều khoản chuyển tiếp phụ thuộc tình trạng hồ sơ tại mốc này. Xác nhận tình trạng trước khi chọn mẫu.',
      { missing: ['pendingAtCutover'], citations: cite(transitionIds) });
  }

  const applicableOn = mode === 'case' ? receivedOn : asOf;
  const closedBeforeCutover = crossesCutover && !pendingAtCutover;
  const rule = crossesCutover ? (closedBeforeCutover ? 'closed_history' : 'transition')
    : applicableOn < cutover ? 'before_cutover' : 'from_cutover';
  const formId = spec.versions.find(id => applicability(forms[id], applicableOn) === 'applicable');
  const form = formId ? formView(formId, applicableOn, asOf) : null;
  const formBasis = formId ? forms[formId].basis : spec.basis;
  if (!formBasis) return result('needs_review', 'missing_version', 'Chưa có phiên bản được đối chiếu', 'Kiểm tra văn bản và phụ lục gốc.');

  const beforeOrAfter = applicableOn < cutover ? 'trước 01/07/2026' : 'từ 01/07/2026';
  const temporal = rule === 'transition'
    ? 'Hồ sơ tiếp nhận trước 01/07/2026 và còn đang giải quyết tại mốc này. Đối chiếu quy định tại ngày tiếp nhận ' + displayDate(applicableOn) + '.'
    : rule === 'closed_history'
      ? 'Hồ sơ đã giải quyết trước mốc chuyển tiếp. Kết quả dưới đây dùng để đọc lại phiên bản tại ngày tiếp nhận.'
      : 'Đối chiếu quy định ' + beforeOrAfter + ' theo ngày ' + displayDate(applicableOn) + '.';
  const title = !form ? 'Dùng văn bản phản hồi theo thông báo thẩm định'
    : rule === 'transition' ? 'Đối chiếu mẫu tại ngày tiếp nhận'
      : rule === 'closed_history' ? 'Xem mẫu lịch sử của hồ sơ'
        : 'Mẫu số ' + form.number + ' tại Phụ lục ' + form.appendix;
  const note = !form ? ' Trình bày rõ nội dung sửa đổi, bổ sung trong văn bản phản hồi theo căn cứ đã dẫn.' : '';
  const timingBasis = crossesCutover ? transitionIds : (spec.versions.length > 1 ? [cutoverBasis.effective] : []);
  const citations = [
    ...cite(formBasis, applicableOn),
    ...cite(timingBasis, asOf)
  ];
  return result(closedBeforeCutover ? 'historical' : 'grounded', rule, title, temporal + note, {
    applicableOn, form, citations, versions: spec.versions.map(id => formView(id, applicableOn, asOf))
  });
}
