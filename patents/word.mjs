import { crc32 } from 'node:zlib';
import { brandedWordParts } from '../copilot/m4/word-brand.mjs';
import { CaseError } from '../copilot/m3/workflow.mjs';
import { digest } from '../sot/bundle.mjs';

export const patentWordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body;
function escape(value) {
  const text = String(value);
  for (const character of text) {
    const code = character.codePointAt(0);
    if ((code < 0x20 && ![9, 10, 12, 13].includes(code)) || (code >= 0xD800 && code <= 0xDFFF) || code === 0xFFFE || code === 0xFFFF) {
      throw new CaseError('Văn bản chứa ký tự điều khiển không hợp lệ cho Word. Kiểm tra và sửa bản nháp trước khi xuất.', 422);
    }
  }
  return text.replace(/\u000c/g, '\n').replace(/\u2014/g, '\u2013').replace(/[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}
const tail = text => text.replace(/ (\S+)$/u, '\u00a0$1');
const run = value => value.split(/(\t|\f|\r\n|\r|\n)/).map(part => part === '\t' ? '<w:tab/>' : /^[\f\r\n]+$/.test(part) ? '<w:br/>' : '<w:t xml:space="preserve">' + escape(part) + '</w:t>').join('');
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
  const state = { disclosed: 'Có đoạn mô tả liên quan', not_found: 'Chưa thấy trong đoạn được chọn', uncertain: 'Cần làm rõ' };
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
