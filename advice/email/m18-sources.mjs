import assert from 'node:assert/strict';

const scope = ['th', 'pt', 'annuity', 'poa'];
const drafts = {
  old: { title: 'M18 Old.docx', value: 'verify-office-record', issuer: 'partner-alpha',
    text: 'Nguồn diễn tập. Trước khi tiến hành, cần xác nhận riêng việc sử dụng POA hiện hữu.' },
  current: { title: 'M18 Partner Alpha.eml', value: 'reuse', issuer: 'partner-alpha',
    text: 'Nguồn diễn tập. Đối tác A xác nhận có thể tiếp tục dùng POA đã lưu khi chủ bằng và phạm vi ủy quyền giữ nguyên.' },
  disputed: { title: 'M18 Partner Beta.eml', value: 'new', issuer: 'partner-beta',
    text: 'Nguồn diễn tập. Đối tác B yêu cầu một POA mới cho cùng phạm vi công việc.' },
};

export async function m18Sources(request, wordBytes) {
  const candidates = new Map();
  const ids = new Map();
  for (const [key, row] of Object.entries(drafts)) {
    const base64 = key === 'old' ? wordBytes.toString('base64') :
      Buffer.from('From: fixture@example.test\r\nTo: pilot@example.test\r\nSubject: M18 fixture\r\n' +
        'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n' + row.text).toString('base64');
    const { sha } = await request('import', { name: row.title, owner: 'Diễn tập M18',
      permission: 'Dữ liệu tổng hợp để kiểm luồng.', base64, allowed: true });
    const record = await request('document/' + sha);
    const paragraph = key === 'old' ? record.paragraphs.find(part => part.quote.length >= 12) :
      record.paragraphs.find(part => part.quote === row.text);
    assert.ok(paragraph, row.title);
    candidates.set(key, { sha, paragraph: paragraph.paragraph, digest: paragraph.digest });
  }
  return {
    ids,
    async approve(key) {
      const row = drafts[key];
      const { id } = await request('approve', {
        ...candidates.get(key), confirmed: true, scope, value: row.value,
        issuer: row.issuer, statement: row.text, date: key === 'old' ? '2026-08-01' : '2026-09-01',
        ...(key === 'old' ? {} : { clientText: row.text }),
        ...(key === 'current' ? { supersedes: ids.get('old') } : {}),
      });
      ids.set(key, id);
    },
  };
}
