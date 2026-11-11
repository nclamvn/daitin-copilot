import { crc32 } from 'node:zlib';
import { brandedWordParts } from '../copilot/m4/word-brand.mjs';
import { CaseError } from '../copilot/m3/workflow.mjs';
import { digest } from '../sot/bundle.mjs';

export const patentWordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body;
function escape(value, preservePunctuation = false) {
  const text = String(value);
  for (const character of text) {
    const code = character.codePointAt(0);
    if ((code < 0x20 && ![9, 10, 12, 13].includes(code)) || (code >= 0xD800 && code <= 0xDFFF) || code === 0xFFFE || code === 0xFFFF) {
      throw new CaseError('Văn bản chứa ký tự điều khiển không hợp lệ cho Word. Kiểm tra và sửa bản nháp trước khi xuất.', 422);
    }
  }
  const printable = preservePunctuation ? text : text.replace(/\u2014/g, '\u2013');
  return printable.replace(/\u000c/g, '\n').replace(/[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}
const tail = text => text.replace(/ (\S+)$/u, '\u00a0$1');
const run = (value, preservePunctuation = false) => value.split(/(\t|\f|\r\n|\r|\n)/).map(part => part === '\t' ? '<w:tab/>' : /^[\f\r\n]+$/.test(part) ? '<w:br/>' : '<w:t xml:space="preserve">' + escape(part, preservePunctuation) + '</w:t>').join('');
const containsFormFeed = value => typeof value === 'string' ? value.includes('\f') :
  Boolean(value && typeof value === 'object' && Object.values(value).some(containsFormFeed));
const p = (text, bold = false) => '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:spacing w:after="70" w:line="270" w:lineRule="auto"/></w:pPr>' +
  '<w:r><w:rPr><w:sz w:val="21"/>' + (bold ? '<w:b/>' : '') + '</w:rPr>' + run(tail(text)) + '</w:r></w:p>';

function zip(parts) {
  const local = [], central = []; let offset = 0;
  for (const [filename, value] of Object.entries(parts)) {
    const name = Buffer.from(filename), data = Buffer.from(value), checksum = crc32(data);
    const header = Buffer.alloc(30), index = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    index.writeUInt32LE(0x02014b50, 0); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(33, 14);
    index.writeUInt32LE(checksum, 16); index.writeUInt32LE(data.length, 20); index.writeUInt32LE(data.length, 24);
    index.writeUInt16LE(name.length, 28); index.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(index, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function matrix(rows, targetClaimId) {
  const widths = [1460, 2220, 2420, 2786];
  const state = { disclosed: 'Có đoạn mô tả liên quan', different: 'Hai đoạn ghi đặc điểm hoặc điều kiện khác nhau',
    not_found: 'Chưa thấy trong đoạn được chọn', uncertain: 'Cần làm rõ' };
  const cell = (text, index, header = false) => '<w:tc><w:tcPr><w:tcW w:w="' + widths[index] + '" w:type="dxa"/>' +
    (header ? '<w:shd w:val="clear" w:fill="F2F2F2" w:color="auto"/>' : '') + '<w:vAlign w:val="top"/></w:tcPr>' +
    text.split('\n').map(line => p(line, header)).join('') + '</w:tc>';
  const row = (values, header = false) => '<w:tr><w:trPr>' + (header ? '<w:tblHeader/><w:cantSplit/>' : '') +
    '</w:trPr>' + values.map((value, index) => cell(value, index, header)).join('') + '</w:tr>';
  return '<w:tbl><w:tblPr><w:tblW w:w="8886" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
    '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => '<w:' + side + ' w:val="single" w:sz="4" w:color="BFBFBF"/>').join('') +
    '</w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid>' + widths.map(width => '<w:gridCol w:w="' + width + '"/>').join('') + '</w:tblGrid>' +
    row(['Đặc điểm', 'Trích yêu cầu bảo hộ', 'Đoạn trích từ D1', 'Nhận định cần rà soát'], true) + rows.map(item =>
      row([item.feature, (item.claimQuoteRecordId && item.claimQuoteRecordId !== targetClaimId ? '[' + item.claimQuoteRecordId + '] Ngữ cảnh dẫn chiếu\n' : '') + item.claimQuote, (item.d1RecordId ? '[' + item.d1RecordId + ']\n' : '') + (item.d1Quote || 'Chưa có đoạn chứng cứ.'),
        state[item.assessment] + '\n' + item.analysis + (item.missing ? '\nCần bổ sung: ' + item.missing : '')])).join('') + '</w:tbl>';
}

export function makePatentWord(release) {
  const { sha256, ...content } = release;
  if (release.template !== 'daitin-patent-v1' || digest(content) !== sha256) throw new CaseError('Bản duyệt sáng chế chưa khớp dấu kiểm hoặc mẫu.', 409);
  const marker = '__DAITIN_PATENT_MATRIX_V1__';
  const fields = 'Hồ sơ mô phỏng. Nguồn ứng viên, chưa phải kết luận tính mới, hiệu lực hoặc FTO.\n' +
    'Phiên bản yêu cầu: ' + release.context.claimVersion + ' · Ngày đối chiếu: ' + release.context.asOf + '\n' +
    'Yêu cầu bảo hộ đang nghiên cứu:\n' + release.claimText + '\n\nThông báo của hồ sơ:\n' + release.noticeText +
    '\n\nChỉ dẫn nghiệp vụ:\n' + release.instructionsText;
  const ocrNotice = release.pinnedEvidence.some(item => /ocr/i.test(item.record.textFidelity ?? item.source.textFidelity ?? ''))
    ? '\nBản trích OCR chưa được con người duyệt. Cần mở bản nguồn đã lưu để kiểm tra từ kỹ thuật, dấu và đơn vị trước khi sử dụng nghiệp vụ. Dấu kiểm chỉ xác nhận bản trích không bị đổi, không xác nhận OCR đúng.' : '';
  const presentationNotice = containsFormFeed(release) ? '\nTrình bày: dấu phân trang U+000C trong bản trích nguồn được biểu diễn bằng ngắt dòng trong Word. Nội dung nguồn đã lưu vẫn giữ nguyên.' : '';
  const notes = release.sections.response.text + ocrNotice + presentationNotice + '\n\nNguồn dùng cho bản nháp: ' + release.sections.response.evidenceIds.join(', ') +
    '\nMa trận là nhận định đối chiếu trên các đoạn được chọn. Chưa thấy một đặc điểm trong bộ đoạn này không chứng minh đặc điểm đó không có trong toàn bộ tài liệu hoặc không có trong tình trạng kỹ thuật.';
  const proxy = { number: release.number, sections: { findings: { text: fields }, response: { text: marker }, attachments: { text: notes } },
    basis: { citations: release.pinnedEvidence.map(item => ({ locator: '[' + item.record.id + '] ' + (item.record.locator?.label ?? item.record.title),
      document: item.source.title + ' · ' + item.source.authority + ' · ' + item.source.url + ' · SHA-256 ' + item.source.sha256 + ' · Bản trích: ' + (item.record.textFidelity ?? item.source.textFidelity ?? 'chưa phân loại') +
        ((item.record.requiresOriginalCheck || item.source.requiresOriginalCheck) ? ' · Cần mở bản gốc kiểm tra' : ''),
      page: item.record.locator?.page ?? 'không áp dụng' })) } };
  const parts = brandedWordParts({ reference: release.reference, title: release.title }, proxy, { xml, namespace, run });
  let document = parts['word/document.xml'];
  const slot = '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r>' + run(marker) + '</w:r></w:p>';
  if (!document.includes(slot)) throw new CaseError('Mẫu Word đã đổi; chưa thể đặt ma trận đúng vị trí.', 409);
  document = document.replace(slot, matrix(release.sections.matrix.rows, release.claimRecordId));
  for (const [oldText, newText] of [
    ['Văn bản phản hồi thông báo', 'Phân tích hồ sơ sáng chế'], ['thẩm định nhãn hiệu', 'Yêu cầu bảo hộ và đối chứng D1'],
    ['Nhãn\u00a0hiệu', 'Hồ sơ'], ['Nội dung được yêu cầu làm rõ', 'Phạm vi và yêu cầu bảo hộ'],
    ['Nội dung phản hồi', 'Ma trận đối chiếu kỹ thuật'], ['Tài liệu kèm theo', 'Bản nháp và việc cần xác minh'],
    ['Căn cứ đối chiếu', 'Sổ nguồn đã lưu']
  ]) document = document.replace(escape(oldText), escape(newText));
  parts['word/document.xml'] = document;
  return zip(parts);
}

export const patentWordRendererV2 = 'daitin-patent-v2';

const fidelityLabels = {
  source_native_xml: 'Văn bản từ XML công bố',
  source_native_pdf_text: 'Lớp chữ trong PDF nguồn',
  source_html_text: 'Văn bản từ trang nguồn',
  ocr_unreviewed: 'OCR chưa được rà soát',
  mixed_native_and_ocr_unreviewed: 'Có phần OCR chưa được rà soát',
  pdf_text_user_confirmed: 'Đoạn từ lớp chữ PDF đã được xác nhận trong hồ sơ'
};
const assessmentLabels = {
  disclosed: 'Có đoạn mô tả liên quan trong D1',
  different: 'Hai đoạn ghi đặc điểm hoặc điều kiện khác nhau',
  not_found: 'Chưa thấy đặc điểm trong đoạn D1 đã chọn',
  uncertain: 'Cần làm rõ chứng cứ'
};
const documentRoleLabels = { notice: 'Thông báo', claim: 'Yêu cầu bảo hộ', d1: 'Đối chứng D1' };

function paragraphV2(text, style, { original = false, keepTail = true, keepNext = false } = {}) {
  const value = !original && keepTail ? tail(text) : text;
  return '<w:p><w:pPr><w:pStyle w:val="' + style + '"/>' + (keepNext ? '<w:keepNext/>' : '') +
    '</w:pPr><w:r>' + run(value, original) + '</w:r></w:p>';
}

function proseV2(text) {
  return text.split(/\r\n|\n|\r/u).map(line => paragraphV2(line, line ? 'Normal' : 'Gap')).join('');
}

function quoteV2(text) {
  // XML represents source line breaks and tabs structurally. Keep the quoted
  // words, punctuation and spaces intact instead of protecting prose endings.
  return paragraphV2(text, 'PatentQuote', { original: true });
}

function wordEvidenceV2(release) {
  const documents = new Map((release.documents ?? []).map(document => [document.recordId, document]));
  const evidence = new Map();
  function add(id, fields) {
    evidence.set(id, { number: 'N' + String(evidence.size + 1).padStart(2, '0'), ...fields });
  }
  for (const { record, source } of release.pinnedEvidence) {
    const document = documents.get(record.id);
    const privateSource = Boolean(document) || source.kind === 'case_document';
    const fidelity = record.textFidelity ?? source.textFidelity;
    add(record.id, {
      title: document?.label ?? source.title,
      locator: document ? 'Trang PDF ' + document.page : record.locator?.label ?? record.title,
      authority: privateSource ? 'PDF riêng của hồ sơ' : source.authority,
      url: privateSource ? null : source.url,
      sha256: document?.sha256 ?? source.sha256,
      fidelity: fidelityLabels[fidelity] ?? 'Chưa phân loại bản trích',
      checkOriginal: !privateSource && (/ocr/i.test(fidelity ?? '') || record.requiresOriginalCheck || source.requiresOriginalCheck),
      document
    });
  }
  for (const item of release.privateEvidence ?? []) {
    if (item.id === 'case:claim' && evidence.has(release.claimRecordId)) {
      // Both IDs can appear in response references. They refer to one source
      // when a stored publication or private PDF supplies the target claim.
      continue;
    }
    const document = documents.get(item.id) ?? item.document;
    add(item.id, {
      title: document?.label ?? item.label,
      locator: document ? 'Trang PDF ' + document.page : 'Dữ kiện riêng của hồ sơ',
      authority: document ? 'PDF riêng của hồ sơ' : 'Nội dung đã lưu trong hồ sơ',
      sha256: document?.sha256 ?? item.sha256,
      fidelity: document ? fidelityLabels.pdf_text_user_confirmed : 'Nội dung do người dùng cung cấp',
      document
    });
  }
  const lookup = id => evidence.get(id === 'case:claim' && evidence.has(release.claimRecordId) ? release.claimRecordId : id);
  const reference = id => {
    const item = lookup(id);
    return item ? '[' + item.number + ']' : '';
  };
  const quoteLabel = (label, id) => {
    const item = lookup(id);
    return [label, reference(id), item?.locator, item?.checkOriginal ? 'Mở bản gốc để đối chiếu' : ''].filter(Boolean).join(' · ');
  };
  const ledger = () => Array.from(evidence.values()).map(item => {
    const { document } = item;
    const summary = [item.authority, documentRoleLabels[document?.role], item.locator, item.fidelity].filter(Boolean).join(' · ');
    const hashLabel = item.authority === 'Nội dung đã lưu trong hồ sơ' ? 'SHA-256 nội dung ' : 'SHA-256 bản gốc ';
    const lines = [
      { text: '[' + item.number + '] ' + item.title, style: 'PatentEvidenceTitle', keepTail: !document },
      { text: summary, style: 'PatentMeta' }
    ];
    if (item.url) lines.push({ text: item.url, style: 'PatentLocator', keepTail: false });
    if (item.sha256) lines.push({ text: hashLabel + item.sha256, style: 'PatentLocator', keepTail: false });
    if (document?.textSha256) lines.push({ text: 'SHA-256 đoạn đã chọn ' + document.textSha256, style: 'PatentLocator', keepTail: false });
    if (item.checkOriginal) lines.push({ text: 'Cần đối chiếu bản gốc trước khi sử dụng đoạn trích.', style: 'PatentMeta' });
    return lines.map(({ text, style, keepTail }, index) =>
      paragraphV2(text, style, { keepTail, keepNext: index < lines.length - 1 })).join('');
  }).join('');
  return { quoteLabel, reference, ledger };
}

function wordApprovalV2(approval) {
  const identity = approval.by?.name ? ' · ' + approval.by.name : '';
  const date = approval.at ? ' · ' + approval.at.slice(0, 10) : '';
  const reviewed = approval.reviewedEvidence === true ? ' · Đã xác nhận rà soát chứng cứ' : '';
  return paragraphV2('Duyệt nội bộ' + identity + date + reviewed, 'PatentApproval');
}

function wordMatrixV2(release, quoteLabel) {
  return release.sections.matrix.rows.map((row, index) => {
    const claimId = row.claimQuoteRecordId ?? release.claimRecordId ?? 'case:claim';
    const claimLabel = row.claimQuoteRecordId && row.claimQuoteRecordId !== release.claimRecordId
      ? 'Yêu cầu bảo hộ dẫn chiếu' : 'Yêu cầu bảo hộ';
    const assessment = assessmentLabels[row.assessment];
    return [
      paragraphV2(String(index + 1) + '. ' + row.feature, 'PatentFeature'),
      paragraphV2(quoteLabel(claimLabel, claimId), 'PatentLabel'),
      quoteV2(row.claimQuote),
      paragraphV2(quoteLabel('Đối chứng D1', row.d1RecordId), 'PatentLabel'),
      row.d1Quote ? quoteV2(row.d1Quote) : paragraphV2('Chưa chọn được đoạn chứng cứ.', 'PatentMeta'),
      paragraphV2(assessment ? 'Nhận định đối chiếu · ' + assessment : 'Nhận định đối chiếu', 'PatentLabel'),
      proseV2(row.analysis),
      ...(row.missing ? [paragraphV2('Việc cần xác minh', 'PatentLabel'), proseV2(row.missing)] : [])
    ].join('');
  }).join('');
}

function wordStylesV2() {
  const fonts = family => '<w:rFonts w:ascii="' + family + '" w:hAnsi="' + family + '" w:eastAsia="' + family + '" w:cs="' + family + '"/>';
  const style = (id, name, paragraphProperties, { family = 'Arial', size = 20, color = '000000', bold = false } = {}) =>
    '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr>' + paragraphProperties + '</w:pPr><w:rPr>' + fonts(family) + (bold ? '<w:b/>' : '') +
    '<w:color w:val="' + color + '"/><w:sz w:val="' + size + '"/></w:rPr></w:style>';
  return [
    style('PatentFeature', 'Đặc điểm đối chiếu', '<w:keepNext/><w:keepLines/><w:pBdr><w:top w:val="single" w:sz="4" w:space="7" w:color="BFBFBF"/></w:pBdr><w:spacing w:before="260" w:after="70"/><w:outlineLvl w:val="1"/>', { size: 22, bold: true }),
    style('PatentLabel', 'Nhãn chứng cứ', '<w:keepNext/><w:keepLines/><w:spacing w:before="65" w:after="40" w:line="260" w:lineRule="auto"/>', { bold: true }),
    style('PatentQuote', 'Đoạn trích nguyên văn', '<w:widowControl/><w:pBdr><w:left w:val="single" w:sz="8" w:space="8" w:color="BFBFBF"/></w:pBdr><w:spacing w:after="135" w:line="292" w:lineRule="auto"/><w:ind w:left="260"/>', { family: 'Georgia', size: 22 }),
    style('PatentMeta', 'Thông tin kiểm chứng', '<w:widowControl/><w:spacing w:after="85" w:line="263" w:lineRule="auto"/>', { size: 19, color: '444444' }),
    style('PatentApproval', 'Thông tin duyệt nội bộ', '<w:keepNext/><w:keepLines/><w:spacing w:after="85" w:line="263" w:lineRule="auto"/>', { size: 19, color: '444444' }),
    style('PatentEvidenceTitle', 'Tên nguồn', '<w:keepNext/><w:keepLines/><w:spacing w:before="125" w:after="42"/>', { bold: true }),
    style('PatentLocator', 'Định danh và dấu kiểm', '<w:widowControl/><w:spacing w:after="50" w:line="250" w:lineRule="auto"/>', { size: 17, color: '444444' })
  ].join('');
}

export function makePatentWordV2(release) {
  const { sha256, ...content } = release;
  if (release.template !== patentWordRendererV2 || (sha256 !== undefined && digest(content) !== sha256) ||
      !release.sections?.matrix?.approval || !release.sections?.response?.approval) {
    throw new CaseError('Bản duyệt sáng chế chưa khớp dấu kiểm, nội dung duyệt hoặc mẫu.', 409);
  }
  const { quoteLabel, reference, ledger } = wordEvidenceV2(release);
  const section = (number, label) => paragraphV2(number + '\t' + label, 'Heading1');
  const sources = [...new Set(release.sections.response.evidenceIds.map(reference).filter(Boolean))];
  const presentation = containsFormFeed(release)
    ? paragraphV2('Dấu phân trang U+000C trong nguồn được trình bày bằng ngắt dòng.', 'PatentMeta') : '';
  const body = [
    section('01', 'Dữ kiện hồ sơ'),
    paragraphV2('Hồ sơ mô phỏng để rà soát nội bộ.', 'PatentMeta'),
    paragraphV2('Phiên bản yêu cầu ' + release.context.claimVersion + ' · Ngày đối chiếu ' + release.context.asOf, 'PatentMeta'),
    paragraphV2(quoteLabel('Yêu cầu bảo hộ đang xét', release.claimRecordId ?? 'case:claim'), 'PatentLabel'),
    quoteV2(release.claimText),
    paragraphV2(quoteLabel('Thông báo của hồ sơ', 'case:notice'), 'PatentLabel'),
    quoteV2(release.noticeText),
    paragraphV2(quoteLabel('Chỉ dẫn nghiệp vụ', 'case:instructions'), 'PatentLabel'),
    quoteV2(release.instructionsText),
    section('02', 'Đối chiếu từng đặc điểm'),
    wordApprovalV2(release.sections.matrix.approval),
    paragraphV2('Ma trận chỉ xét các đoạn đã chọn. Tính mới, hiệu lực quyền và quyền tự do khai thác cần được đánh giá riêng.', 'PatentMeta', { keepNext: true }),
    wordMatrixV2(release, quoteLabel),
    section('03', 'Phản hồi đã duyệt'),
    wordApprovalV2(release.sections.response.approval),
    proseV2(release.sections.response.text),
    ...(sources.length ? [paragraphV2('Nguồn dùng trong phản hồi ' + sources.join(', '), 'PatentMeta')] : []),
    presentation,
    section('04', 'Sổ chứng cứ'),
    ledger()
  ].join('');
  const shell = { number: release.number, sections: { findings: { text: '' }, response: { text: '' }, attachments: { text: '' } }, basis: { citations: [] } };
  const parts = brandedWordParts({ reference: release.reference, title: release.title }, shell, { xml, namespace, run });
  const original = parts['word/document.xml'];
  // Keep the approved masthead, identity panel and folio. Replace the trademark
  // section body so patent excerpts and the ledger can flow across pages.
  const bodyStart = original.indexOf('<w:p><w:pPr><w:pStyle w:val="Heading1"/>');
  const bodyEnd = original.indexOf('<w:sectPr>');
  if (bodyStart < 0 || bodyEnd <= bodyStart) throw new CaseError('Mẫu Word Đại Tín đã đổi cấu trúc.', 409);
  const header = original.slice(0, bodyStart)
    .replace('Văn bản phản hồi thông báo', 'Phân tích hồ sơ sáng chế')
    .replace('thẩm định nhãn hiệu', 'Yêu cầu bảo hộ và đối chứng D1')
    .replace('Nhãn\u00a0hiệu', 'Hồ sơ');
  parts['word/document.xml'] = header + body + original.slice(bodyEnd);
  parts['word/styles.xml'] = parts['word/styles.xml'].replace('</w:styles>', wordStylesV2() + '</w:styles>');
  return zip(parts);
}
