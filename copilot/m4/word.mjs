import { crc32 } from 'node:zlib';
import { hash, ids, renderRelease, sections, CaseError } from '../m3/workflow.mjs';

const xml = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body;
const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
function text(value) {
  if (/[^\u0009\u000a\u000d\u0020-\uD7ff\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value)) {
    throw new CaseError('Bản duyệt có ký tự chưa thể giữ nguyên trong Word.', 422);
  }
  return value.replace(/[&<>"']/g, char => escapes[char]);
}
const run = value => value.split('\t').map(part => '<w:t xml:space="preserve">' + text(part) + '</w:t>').join('<w:tab/>');
const para = (value, style = 'Normal') =>
  '<w:p><w:pPr><w:pStyle w:val="' + style + '"/></w:pPr><w:r>' + run(value) + '</w:r></w:p>';

function zip(parts) {
  const entries = [];
  const index = [];
  let offset = 0;
  for (const [filename, value] of Object.entries(parts)) {
    const name = Buffer.from(filename);
    const data = Buffer.from(value);
    const digest = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(digest, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(digest, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    entries.push(local, name, data);
    index.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(index);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(index.length / 2, 8);
  end.writeUInt16LE(index.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, directory, end]);
}

export const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function makeWord(matter, release) {
  if (!release || renderRelease({ ...matter, basis: release.basis }, release.sections, release.number) !== release.markdown ||
      hash(release.markdown) !== release.sha256) throw new CaseError('Dữ liệu bản duyệt chưa khớp dấu kiểm.', 409);
  const title = 'Văn bản phản hồi thông báo thẩm định nhãn hiệu';
  const fields = matter.document?.fields;
  const confirmed = [['application', 'Số đơn'], ['noticeNumber', 'Số thông báo'], ['noticeDate', 'Ngày thông báo']]
    .filter(([key]) => fields?.[key]?.value)
    .map(([key, label]) => para(label + '  ' + fields[key].value, 'Meta'));
  const body = [
    para(title, 'Title'), para('Hồ sơ ' + matter.reference + ' · ' + matter.title, 'Meta'),
    para('Bản duyệt nội bộ ' + release.number, 'Meta'), ...confirmed,
    ...ids.flatMap(key => [para(sections[key], 'Heading1'),
      ...release.sections[key].text.split(/\r\n|\r|\n/u).map(line => para(line))]),
    para('Căn cứ đối chiếu', 'Heading1'),
    ...release.basis.citations.map(item => para(item.locator + ' · ' + item.document + ' · trang PDF ' + item.page)),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1332" w:right="1417" w:bottom="1332" w:left="1531" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
  ].join('');
  const styles = '<w:styles xmlns:w="' + namespace + '"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:color w:val="000000"/><w:sz w:val="24"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:widowControl/><w:spacing w:after="100" w:line="300" w:lineRule="auto"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:after="180"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Dấu vết bản duyệt"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:after="60"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="150" w:after="70"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/></w:rPr></w:style></w:styles>';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const packageRels = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const relFile = (type, target) => xml('<Relationships xmlns="' + packageRels + '"><Relationship Id="rId1" Type="' + rel + type + '" Target="' + target + '"/></Relationships>');
  return zip({
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': relFile('officeDocument', 'word/document.xml'),
    'word/document.xml': xml('<w:document xmlns:w="' + namespace + '"><w:body>' + body + '</w:body></w:document>'),
    'word/styles.xml': xml(styles),
    'word/_rels/document.xml.rels': relFile('styles', 'styles.xml')
  });
}
