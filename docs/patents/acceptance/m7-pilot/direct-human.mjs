import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { privateEvidence } from '../../../../patents/workflow.mjs';
import { readJSON, sha, timestamp, track, writeJSON } from './common.mjs';

const assessments = ['disclosed', 'different', 'uncertain', 'not_found'];
const cleanText = (value, limit) => typeof value === 'string' && value.isWellFormed() &&
  value.length <= limit && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value);

export class HumanPilotError extends Error {}

function validatedMatrix(value, matter) {
  if (!Array.isArray(value?.rows) || value.rows.length < 1 || value.rows.length > 8) {
    throw new HumanPilotError('Ma trận cần 1–8 hàng. Hãy lưu lại tệp rà soát.');
  }
  const d1 = matter.pinnedEvidence.find(item => matter.d1RecordIds.includes(item.record.id))?.record;
  const rows = value.rows.map(row => {
    const d1RecordId = row?.d1RecordId ?? null;
    const d1Quote = row?.d1Quote ?? '';
    if (!row || !assessments.includes(row.assessment) ||
      !cleanText(row.feature, 350) || !row.feature.trim() || !cleanText(row.analysis, 1000) ||
      !row.analysis.trim() || !cleanText(row.missing, 700) || !cleanText(row.claimQuote, 1800) ||
      !row.claimQuote.trim() || !matter.claimText.includes(row.claimQuote) ||
      !cleanText(d1Quote, 1800) || (d1RecordId === null ? d1Quote !== ''
        : !d1 || d1RecordId !== d1.id || !d1Quote.trim() || !d1.text.includes(d1Quote))) {
      throw new HumanPilotError('Một hàng ma trận có trường hoặc đoạn trích không hợp lệ. Đối chiếu lại PDF đã khóa.');
    }
    return { feature: row.feature, claimQuote: row.claimQuote, claimQuoteRecordId: matter.claimRecordId,
      d1RecordId, d1Quote, assessment: row.assessment, analysis: row.analysis, missing: row.missing };
  });
  return { rows };
}

function validatedResponse(value, matter) {
  const allowed = new Set([...matter.evidenceIds, ...privateEvidence(matter).map(item => item.id)]);
  if (!cleanText(value?.text, 6000) || !value.text.trim() || !Array.isArray(value.evidenceIds) ||
    value.evidenceIds.length < 1 || value.evidenceIds.length > 8 ||
    new Set(value.evidenceIds).size !== value.evidenceIds.length || value.evidenceIds.some(id => !allowed.has(id))) {
    throw new HumanPilotError('Phản hồi cần nội dung và mã nguồn thuộc hồ sơ đã khóa.');
  }
  return { text: value.text, evidenceIds: value.evidenceIds };
}

function readReview(path) {
  const bytes = readFileSync(path);
  if (bytes.length > 65536) throw new HumanPilotError('Tệp rà soát vượt 64 KiB.');
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new HumanPilotError('Tệp rà soát chưa đúng JSON. Hãy lưu lại rồi thử tiếp.'); }
}

export async function approveDirectDraft({ ledger, out, entry, phase, matter, draft, ask, show }) {
  const base = join(out, 'direct-workspace', entry.id);
  const reviewPath = base + '-review-' + phase + '.json';
  const approvalPath = base + '-approvals-' + phase + '.json';
  const targets = phase === 1 ? ['matrix', 'response'] : ['response'];
  const draftSha256 = sha(JSON.stringify(draft));
  const checkpoint = existsSync(approvalPath) ? readJSON(approvalPath) :
    { phase, draftSha256, manifestSha256: ledger.state.manifestSha256, sections: {} };
  if (checkpoint.phase !== phase || checkpoint.draftSha256 !== draftSha256 ||
    checkpoint.manifestSha256 !== ledger.state.manifestSha256) {
    throw new HumanPilotError('Biên nhận rà soát đã thay đổi. Hãy giữ nguyên thư mục pilot để điều phối viên đối chiếu.');
  }
  if (!existsSync(reviewPath)) writeJSON(reviewPath, Object.fromEntries(targets.map(key => [key, draft[key]])));
  show('Mở và chỉnh nếu cần, rồi lưu tệp rà soát: ' + reviewPath);
  show('Đối chiếu PDF đã khóa và các đoạn chọn trước khi xác nhận từng phần.');
  const sections = {};
  for (const key of targets) {
    let saved = checkpoint.sections[key];
    const validate = key === 'matrix' ? validatedMatrix : validatedResponse;
    if (!saved) {
      const review = readReview(reviewPath);
      const content = validate(review?.[key], matter);
      const digest = sha(JSON.stringify(content));
      const label = key === 'matrix' ? 'ma trận' : 'phản hồi';
      const confirmed = await ask('Anh Bình đã rà nguồn và đồng ý duyệt ' + label + '? [y/N] ');
      if (confirmed.trim().toLowerCase() !== 'y') {
        track(ledger, 'operator', entry.id, phase, 'leave direct draft for review', { section: key });
        throw new HumanPilotError('Đã giữ bản nháp. Mở lại đúng phiên để tiếp tục rà soát.');
      }
      const after = validate(readReview(reviewPath)?.[key], matter);
      if (sha(JSON.stringify(after)) !== digest) {
        throw new HumanPilotError('Nội dung thay đổi trong lúc xác nhận. Mở lại phiên và duyệt đúng bản đã đọc.');
      }
      saved = { content, approval: { by: { name: 'binh', role: 'reviewer' }, at: timestamp(),
        sha256: digest, reviewedEvidence: true, provenance: 'operator_attested' } };
      checkpoint.sections[key] = saved;
      writeJSON(approvalPath, checkpoint);
      track(ledger, 'operator', entry.id, phase, 'human approves direct section', { section: key, at: saved.approval.at, sha256: digest });
    }
    const content = validate(saved.content, matter);
    if (saved.approval?.by?.name !== 'binh' || saved.approval?.provenance !== 'operator_attested' ||
      saved.approval?.reviewedEvidence !== true || !Number.isFinite(Date.parse(saved.approval.at)) ||
      saved.approval.sha256 !== sha(JSON.stringify(content))) {
      throw new HumanPilotError('Dấu kiểm phần đã duyệt bị thay đổi.');
    }
    sections[key] = { ...content, approval: saved.approval };
  }
  return sections;
}
