import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspectPDF as popplerInspect } from '../copilot/m4/pdf.mjs';
import { inspectWithPDFJS } from '../copilot/m4/pdf-js.mjs';

const prior = process.env.DAI_TIN_PDF_ENGINE;
process.env.DAI_TIN_PDF_ENGINE = 'pdfjs';
const { inspectPDF, renderPage, pdfInput, maxPDF, bindPDF } = await import('../copilot/m4/pdf.mjs?engine=pdfjs');
if (prior === undefined) delete process.env.DAI_TIN_PDF_ENGINE;
else process.env.DAI_TIN_PDF_ENGINE = prior;

const fixture = name => readFileSync(new URL('../distribution/demo/' + name, import.meta.url));
const seed = JSON.parse(fixture('seed.json'));
const flat = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

test('PDF.js preserves all eight synthetic PDFs, source anchors and six field candidates against Poppler', async () => {
  assert.equal(maxPDF, 2 * 1024 * 1024);
  for (const item of seed.cases) {
    const bytes = fixture(item.pdf);
    const expected = await popplerInspect(bytes);
    const actual = await inspectPDF(bytes);
    assert.equal(actual.sha256, item.matter.document.sha256);
    assert.equal(actual.pages.length, expected.pages.length, item.pdf);
    assert.deepEqual(actual.pages.map(row => flat(row.text)), expected.pages.map(row => flat(row.text)), item.pdf);
    assert.deepEqual(actual.fields, expected.fields, item.pdf);
    const fields = Object.fromEntries(Object.entries(item.matter.document.fields).map(([key, field]) => [key, field.value]));
    const body = { title: item.matter.title, receivedOn: item.matter.facts.receivedOn,
      pdf: { label: item.pdf, sha256: actual.sha256, verified: true, fields, anchors: item.matter.document.anchors } };
    const bound = bindPDF(body, actual, bytes);
    assert.equal(bound.notice.text, item.matter.sources[0].text);
    assert.throws(() => bindPDF({ ...body, pdf: { ...body.pdf, anchors: [{ page: 1, mode: 'text', text: 'Đoạn không có trong tài liệu' }] } }, actual, bytes));
  }
});

test('PDF.js renders eight notices to bounded PNG pages with intact original byte buffers', async () => {
  for (const item of seed.cases) {
    const bytes = fixture(item.pdf);
    const before = createHash('sha256').update(bytes).digest('hex');
    const png = await renderPage(bytes, 1, item.matter.document.pages);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(16) <= 1250);
    assert.ok(png.readUInt32BE(20) > 0 && png.readUInt32BE(20) <= 1250);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), before);
  }
});

const digest = value => createHash('md5').update(value).digest();
const padding = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const password = text => Buffer.concat([Buffer.from(text), padding]).subarray(0, 32);
function rc4(key, data) {
  const box = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + box[i] + key[i % key.length]) & 255; [box[i], box[j]] = [box[j], box[i]]; }
  let i = 0;
  j = 0;
  return Buffer.from([...data].map(byte => { i = (i + 1) & 255; j = (j + box[i]) & 255; [box[i], box[j]] = [box[j], box[i]]; return byte ^ box[(box[i] + box[j]) & 255]; }));
}
// Minimal synthetic PDFs, including valid Standard Security R2 dictionaries.
// No third-party fixture and no customer information is used.
function blankPDF(pages = 1, encryptedPassword = null) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>')];
  let extra = '';
  if (encryptedPassword !== null) {
    const id = Buffer.alloc(16, 1);
    const owner = rc4(digest(password('owner')).subarray(0, 5), password(encryptedPassword));
    const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
    const key = digest(Buffer.concat([password(encryptedPassword), owner, permissions, id])).subarray(0, 5);
    const user = rc4(key, padding);
    objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`);
    extra = ` /Encrypt ${objects.length} 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>]`;
  }
  let file = '%PDF-1.7\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(file)); file += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(file);
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(x => `${String(x).padStart(10, '0')} 00000 n \n`).join('');
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${extra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file);
}

test('cloud PDF limits reject oversize, invalid, too many pages and encrypted files', async () => {
  assert.throws(() => pdfInput({ anonymized: true, content: Buffer.alloc(maxPDF + 1).toString('base64') }));
  await assert.rejects(inspectPDF(Buffer.from('%PDF-1.7 broken')), { status: 422 });
  await assert.rejects(inspectPDF(blankPDF(13)), { status: 422 });
  await assert.rejects(inspectPDF(blankPDF(1, 'demo-password')), { status: 422 });
  await assert.rejects(inspectPDF(blankPDF(1, '')), { status: 422 });
  await assert.rejects(renderPage(blankPDF(1), 0, 1));
  const empty = await inspectPDF(blankPDF());
  assert.equal(empty.pages[0].text, '');
  assert.ok(Object.values(empty.fields).every(values => !values.length));
});

test('PDF.js has a two-document concurrency bound', async () => {
  const bytes = fixture('DT-DEMO-01.pdf');
  const results = await Promise.allSettled([inspectWithPDFJS(bytes), inspectWithPDFJS(bytes), inspectWithPDFJS(bytes)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 2);
  assert.equal(results.find(item => item.status === 'rejected').reason.status, 429);
});
