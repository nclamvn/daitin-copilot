import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const shaPattern = /^[a-f0-9]{64}$/;
const ruleRoles = ['Chủ dữ liệu Đại Tín', 'Luật sư SHTT Đại Tín'];
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
};

export const canonicalJSON = value => JSON.stringify(canonical(value), null, 2) + '\n';
export const digest = value => sha256(canonicalJSON(value));

export function validateApproval(approval, bundle) {
  if (!approval || approval.decision !== 'approved' || approval.digest !== bundle.digest) {
    throw new Error('PHÊ DUYỆT: cần quyết định duyệt đúng mã bản dữ liệu.');
  }
  for (const [field, role] of [['owner', ruleRoles[0]], ['reviewer', ruleRoles[1]]]) {
    const entry = approval[field];
    if (!entry || entry.role !== role || typeof entry.name !== 'string' ||
        entry.name.trim().length < 3 || /^(chưa|tbd|ai|codex|assistant|test|điền|<)/i.test(entry.name.trim())) {
      throw new Error('PHÊ DUYỆT: cần ghi tên người chịu trách nhiệm cho vai trò ' + role);
    }
  }
  if (approval.owner.name.trim().toLocaleLowerCase('vi') === approval.reviewer.name.trim().toLocaleLowerCase('vi')) {
    throw new Error('PHÊ DUYỆT: chủ dữ liệu và người rà soát độc lập phải là hai người.');
  }
  const date = new Date(approval.approvedOn + 'T00:00:00Z');
  if (typeof approval.approvedOn !== 'string' || !Number.isFinite(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== approval.approvedOn || approval.approvedOn < bundle.payload.registry.checkedThrough ||
      approval.scope !== bundle.payload.scope.id) {
    throw new Error('PHÊ DUYỆT: thiếu ngày hoặc phạm vi duyệt hợp lệ.');
  }
  const cases = new Set(Array.isArray(approval.reviewedCases) ? approval.reviewedCases : []);
  if (bundle.payload.reviewCases.some(item => !cases.has(item.id))) {
    throw new Error('PHÊ DUYỆT: còn ca nghiệp vụ bắt buộc chưa được xác nhận.');
  }
}

export function validateBundle(bundle, mode) {
  if (!['preview', 'published'].includes(mode) || !bundle?.payload?.registry || !shaPattern.test(bundle.digest) ||
      digest(bundle.payload) !== bundle.digest) {
    throw new Error('DẤU KIỂM: bản SOT hỏng hoặc đã thay đổi.');
  }
  if (bundle.payload.kind !== 'vn-trademark-sot-v1') throw new Error('SOT: sai kiểu dữ liệu.');
  if (mode === 'published') validateApproval(bundle.approval, bundle);
  else if (bundle.approval !== null) throw new Error('SOT: chế độ thử yêu cầu bản ứng viên.');
  return bundle;
}

export function loadSot(mode) {
  const filename = mode === 'preview' ? 'candidate.json' : mode === 'published' ? 'published.json' : null;
  if (!filename) throw new Error('DAI_TIN_CORPUS_MODE chỉ nhận preview hoặc published.');
  const file = new URL('./' + filename, import.meta.url);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('SOT: chưa có bản ' + (mode === 'preview' ? 'ứng viên. Chạy node sot/cli.mjs build.' : 'được luật sư duyệt và phát hành.'));
    throw error;
  }
  return validateBundle(parsed, mode);
}
