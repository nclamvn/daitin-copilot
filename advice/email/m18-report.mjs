import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { blindPilot, reportPilot } from '../ui/pilot-rules.mjs';

const [command, first, second, third] = process.argv.slice(2);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });

if (command === 'blind') {
  const state = read(first);
  const material = read(second);
  assert.ok(state.entries.filter(row => row.outcome === 'done').every(row => {
    const item = material[row.caseId];
    return item && typeof item.question === 'string' && item.question.trim() &&
      Array.isArray(item.sources) && item.sources.length;
  }), 'Thiếu câu hỏi hoặc nguồn theo mã ca.');
  write(third, blindPilot(state.entries, material));
} else if (command === 'report') {
  const state = read(first);
  const decisions = read(second);
  const codes = new Set(state.entries.filter(row => row.outcome === 'done').map(row => row.code));
  const keys = ['critical', 'correct', 'evidence', 'conditions', 'usable'];
  assert.ok(Array.isArray(decisions) && new Set(decisions.map(row => row.code)).size === decisions.length &&
    decisions.every(row => codes.has(row.code) && keys.every(key => typeof row[key] === 'boolean')),
  'Phiếu chấm không đúng mã hoặc thiếu cột đạt/trượt.');
  write(third, reportPilot(state, decisions));
} else {
  throw new Error('Dùng blind NHAT_KY DU_KIEN_MA_CA PHIEU hoặc report NHAT_KY PHIEU_DA_CHAM BAO_CAO.');
}
