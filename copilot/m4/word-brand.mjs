import { readFileSync } from 'node:fs';
import { ids, sections } from '../m3/workflow.mjs';

export const brandedWordLayout = 'daitin-v2';

const logo = readFileSync(new URL('./brand/daitin-gray.png', import.meta.url));
const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationship = 'http://schemas.openxmlformats.org/package/2006/relationships';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006';
const width = 8886;
const rule = '<w:bottom w:val="single" w:sz="6" w:space="4" w:color="A6A6A6"/>';

export function brandedWordParts(matter, release, { xml, namespace, run }) {
  const textRun = value => '<w:r>' + run(value) + '</w:r>';
  const paragraph = (content, style, extra = '') =>
    '<w:p><w:pPr><w:pStyle w:val="' + style + '"/>' + extra + '</w:pPr>' + content + '</w:p>';
  const keepTail = value => value.replace(/ (\S+)$/u, '\u00a0$1');
  const p = (value, style = 'Normal', extra = '') => paragraph(textRun(keepTail(value)), style, extra);
  const alignRight = '<w:jc w:val="right"/>';
  const borderless = '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';

  function table(columns, rows, props = '', margins = '', fill = '') {
    return '<w:tbl><w:tblPr><w:tblW w:w="' + width + '" w:type="dxa"/>' + props +
      '<w:tblLayout w:type="fixed"/>' + margins + '</w:tblPr><w:tblGrid>' +
      columns.map(size => '<w:gridCol w:w="' + size + '"/>').join('') + '</w:tblGrid>' +
      rows.map(row => '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + row.map(cell =>
        '<w:tc><w:tcPr><w:tcW w:w="' + cell.width + '" w:type="dxa"/>' +
        (cell.span ? '<w:gridSpan w:val="' + cell.span + '"/>' : '') +
        (fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/>' : '') +
        '<w:vAlign w:val="center"/></w:tcPr>' + cell.body + '</w:tc>').join('') + '</w:tr>').join('') + '</w:tbl>';
  }

  const namespaces = ' xmlns:w="' + namespace + '" xmlns:r="' + relationship + '"';
  const logoDrawing = '<w:r><w:drawing><wp:inline xmlns:wp="' + drawing + '/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="1860000" cy="676364"/><wp:docPr id="1" name="DAITIN" descr="Logo DAITIN Lawyers and Consultants"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="' + drawing + '/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="' + drawing + '/main"><a:graphicData uri="' + drawing + '/picture">' +
    '<pic:pic xmlns:pic="' + drawing + '/picture"><pic:nvPicPr><pic:cNvPr id="0" name="daitin-gray.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1860000" cy="676364"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const masthead = table([4370, width - 4370], [[
    { width: 4370, body: paragraph(logoDrawing, 'Mast') },
    { width: width - 4370, body: p('Bản duyệt nội bộ ' + release.number, 'MastStatus', alignRight) + p('daitin.com.vn', 'MastSite', alignRight) }
  ]], '<w:tblBorders><w:bottom w:val="single" w:sz="6" w:color="858585"/></w:tblBorders>');

  const columns = [2740, 3073, 3073];
  const matterFields = matter.document?.fields;
  const meta = (label, value) => p(label, 'FieldLabel') + p(value, 'FieldValue');
  const metadataRows = [[
    { width: columns[0], body: meta('Mã hồ sơ', matter.reference) },
    { width: columns[1] + columns[2], span: 2, body: meta('Nhãn hiệu', matter.title) }
  ]];
  const confirmed = [
    ['Số đơn', matterFields?.application?.value],
    ['Số thông báo', matterFields?.noticeNumber?.value],
    ['Ngày thông báo', matterFields?.noticeDate?.value?.split('-').reverse().join('/')]
  ].filter(([, value]) => value);
  if (confirmed.length) {
    metadataRows.push(confirmed.map(([label, value], index) => ({
      width: index === confirmed.length - 1 ? columns.slice(index).reduce((sum, size) => sum + size, 0) : columns[index],
      span: index === confirmed.length - 1 && confirmed.length < 3 ? 4 - confirmed.length : undefined,
      body: meta(label, value)
    })));
  }
  const panelMargins = '<w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="158" w:type="dxa"/>' +
    '<w:bottom w:w="100" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar>';
  const metadata = table(columns, metadataRows, borderless, panelMargins, 'F2F2F2');

  const title = paragraph(textRun('Văn bản phản hồi thông báo') + '<w:r><w:br/></w:r>' + textRun('thẩm định nhãn hiệu'), 'Title');
  const heading = (index, label) => paragraph(
    '<w:r><w:rPr><w:color w:val="595959"/><w:sz w:val="17"/></w:rPr>' + run(index) + '<w:tab/></w:r>' + textRun(label), 'Heading1');
  const evidence = table([width], [[{ width, body: release.basis.citations.map(item =>
    p(item.locator + ' · ' + item.document + ' · trang PDF ' + item.page, 'Evidence')).join('') }]],
  borderless, panelMargins, 'F6F6F6');

  const body = [
    masthead, title, metadata,
    ...ids.flatMap((key, index) => [heading(String(index + 1).padStart(2, '0'), sections[key]),
      ...release.sections[key].text.split(/\r\n|\r|\n/u).map(line => p(line, line ? 'Normal' : 'Gap'))]),
    heading('04', 'Căn cứ đối chiếu'), evidence,
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1030" w:right="1510" w:bottom="1320" w:left="1510" w:header="520" w:footer="650" w:gutter="0"/></w:sectPr>'
  ].join('');
  const pageField = command => '<w:fldSimple w:instr="' + command + '">' + textRun('1') + '</w:fldSimple>';
  const footer = paragraph(textRun(matter.reference + '  ·  Bản duyệt ' + release.number + '\tTrang ') +
    pageField('PAGE') + textRun(' / ') + pageField('NUMPAGES'), 'Folio',
    '<w:pBdr><w:top w:val="single" w:sz="6" w:space="5" w:color="A6A6A6"/></w:pBdr>' +
    '<w:tabs><w:tab w:val="right" w:pos="' + width + '"/></w:tabs>');
  const fonts = family => '<w:rFonts w:ascii="' + family + '" w:hAnsi="' + family + '" w:eastAsia="' + family + '" w:cs="' + family + '"/>';
  const style = (id, name, pPr, rPr = '') => '<w:style w:type="paragraph" w:styleId="' + id + '"' +
    (id === 'Normal' ? ' w:default="1"' : '') + '><w:name w:val="' + name + '"/>' +
    (id === 'Normal' ? '' : '<w:basedOn w:val="Normal"/>') + '<w:pPr>' + pPr + '</w:pPr><w:rPr>' + rPr + '</w:rPr></w:style>';
  const font = (size, family = 'Arial', color = '000000', bold = false) =>
    fonts(family) + (bold ? '<w:b/>' : '') + '<w:color w:val="' + color + '"/><w:sz w:val="' + size + '"/>';
  const styles = [
    style('Normal', 'Normal', '<w:widowControl/><w:spacing w:after="100" w:line="345" w:lineRule="auto"/>',
      font(23, 'Georgia') + '<w:lang w:val="vi-VN"/>'),
    style('Title', 'Title', '<w:keepNext/><w:keepLines/><w:spacing w:before="310" w:after="285" w:line="264" w:lineRule="auto"/>', font(46, 'Georgia', '000000', true)),
    style('Mast', 'Nhận diện', '<w:spacing w:after="130"/>', font(19)),
    style('MastStatus', 'Trạng thái', '<w:spacing w:after="32"/>', font(21, 'Arial', '000000', true)),
    style('MastSite', 'Trang doanh nghiệp', '<w:spacing w:after="130"/>', font(18, 'Arial', '595959')),
    style('FieldLabel', 'Nhãn trường', '<w:keepNext/><w:spacing w:after="22" w:line="240" w:lineRule="auto"/>', font(17, 'Arial', '595959')),
    style('FieldValue', 'Giá trị hồ sơ', '<w:spacing w:after="0" w:line="260" w:lineRule="auto"/>', font(22, 'Arial', '000000', true)),
    style('Heading1', 'heading 1', '<w:keepNext/><w:keepLines/><w:pBdr>' + rule + '</w:pBdr><w:tabs><w:tab w:val="left" w:pos="430"/></w:tabs><w:spacing w:before="220" w:after="120"/><w:outlineLvl w:val="0"/>', font(23, 'Arial', '000000', true)),
    style('Gap', 'Khoảng đoạn', '<w:spacing w:after="0" w:line="105" w:lineRule="exact"/>', font(16, 'Georgia')),
    style('Evidence', 'Căn cứ', '<w:spacing w:after="0" w:line="315" w:lineRule="auto"/>', font(21, 'Georgia')),
    style('Folio', 'Chân trang', '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>', font(17, 'Arial', '595959'))
  ].join('');
  const rels = entries => xml('<Relationships xmlns="' + packageRelationship + '">' +
    entries.map(([id, type, target]) => '<Relationship Id="' + id + '" Type="' + relationship + '/' + type + '" Target="' + target + '"/>').join('') +
    '</Relationships>');
  const types = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
  return {
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="' + types + 'document.main+xml"/><Override PartName="/word/styles.xml" ContentType="' + types + 'styles+xml"/><Override PartName="/word/settings.xml" ContentType="' + types + 'settings+xml"/><Override PartName="/word/footer1.xml" ContentType="' + types + 'footer+xml"/></Types>'),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/document.xml': xml('<w:document' + namespaces + '><w:body>' + body + '</w:body></w:document>'),
    'word/styles.xml': xml('<w:styles xmlns:w="' + namespace + '">' + styles + '</w:styles>'),
    'word/settings.xml': xml('<w:settings xmlns:w="' + namespace + '"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'),
    'word/footer1.xml': xml('<w:ftr' + namespaces + '>' + footer + '</w:ftr>'),
    'word/_rels/document.xml.rels': rels([['rIdStyles', 'styles', 'styles.xml'], ['rIdSettings', 'settings', 'settings.xml'],
      ['rIdLogo', 'image', 'media/daitin-gray.png'], ['rIdFooter', 'footer', 'footer1.xml']]),
    'word/media/daitin-gray.png': logo
  };
}
