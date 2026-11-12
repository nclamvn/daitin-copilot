import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHumanPilot } from './pilot.mjs';
import { digest, openPrivateStore } from './store.mjs';

const [directory, cardDirectory, mode, modelId, weights] = process.argv.slice(2);
if (!directory || !cardDirectory || !['local', 'remote'].includes(mode)) throw new Error('Cần thư mục kho, phiếu và chế độ phát hành.');
if (mode === 'remote' && (!modelId || !/^[a-f0-9]{64}$/.test(weights))) throw new Error('Cần model và dấu kiểm trọng số đã nạp.');
const review = JSON.parse(readFileSync(new URL('./public-release.json', import.meta.url)));
const queue = JSON.parse(readFileSync(resolve(cardDirectory, 'queue.json')));
const store = openPrivateStore(resolve(directory));
const releasePath = resolve(directory, 'release.json');
const actor = 'codex-public-review';

try {
  const sources = [];
  for (const [id, decision] of Object.entries(review.reviewed)) {
    const item = queue.find(row => row.id === id);
    if (!item || !/^[a-f0-9]{64}$/.test(item.sourceSha256)) throw new Error('Thiếu biên nhận bản chụp ' + id);
    const bytes = readFileSync(resolve(cardDirectory, item.file));
    if (digest(bytes) !== item.cardSha256) throw new Error('Phiếu lệch SHA-256 ' + id);
    const prior = store.list().filter(row => row.name === item.file);
    if (prior.length > 1) throw new Error('Có nhiều phiên bản phiếu cùng tên ' + id);
    const imported = prior[0] ?? await store.importFile({
      name: item.file, base64: bytes.toString('base64'), owner: item.owner, allowed: true,
      permission: 'Nguồn công khai được đối chiếu theo bản chụp. ' + item.origin,
    }, actor);
    const doc = store.document(imported.sha);
    const passage = doc.paragraphs.find(row => row.paragraph === item.paragraph && row.quote === item.excerpt);
    if (!passage || doc.suggestedReview?.retired || doc.suggestedReview?.origin !== item.origin ||
        !doc.paragraphs.some(row => row.quote === 'SHA-256 bản chụp · ' + item.sourceSha256)) {
      throw new Error('Phiếu đang lưu không khớp bản chụp ' + id);
    }
    const approved = doc.review.find(row => row.active && row.paragraph === item.paragraph);
    if (approved && (approved.statement !== decision.statement || approved.origin !== item.origin ||
        approved.clientText !== decision.statement || approved.date !== decision.date || approved.value !== item.value)) {
      throw new Error('Đoạn đã duyệt có nội dung khác biên bản ' + id);
    }
    const selected = approved ?? store.approve({
      sha: doc.sha, paragraph: passage.paragraph, digest: passage.digest, confirmed: true,
      scope: item.scope, issuer: item.issuer, value: item.value, date: decision.date,
      statement: decision.statement, clientText: decision.statement,
    }, actor);
    sources.push(selected.id);
  }

  const published = store.publish();
  if (mode === 'remote') {
    if (store.list().length !== sources.length || published.rows.length !== sources.length ||
        published.rows.some(row => !row.origin || !sources.includes(row.id))) {
      throw new Error('Kho remote chỉ được chứa đúng các phiếu công khai đã duyệt.');
    }
    if (existsSync(releasePath)) throw new Error('Đợt pilot đã được khóa.');
    const modelKey = modelId + '@' + weights;
    const pilot = createHumanPilot(store, () => { throw new Error('Release never calls the model.'); }, modelKey);
    const plan = pilot.create({ title: 'Pilot Đại Tín · Nguồn sở hữu trí tuệ công khai', operator: 'binh',
      grader: 'cham-mu', mode: 'human', questions: review.questions, sources }, { name: 'dieu-phoi', role: 'reviewer' });
    const lock = pilot.detail(plan.id, { name: 'binh' });
    writeFileSync(releasePath, JSON.stringify({
      plan: plan.id, version: published.version, sourceHash: lock.sourceHash, questionsHash: digest(JSON.stringify(lock.questions)), modelKey, reviewedOn: review.reviewedOn,
      documents: store.list().map(row => row.sha).sort(), approved: [...sources].sort(), held: review.held,
    }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log('Locked public pilot', plan.id, review.questions.length, 'questions', published.version);
  } else {
    console.log('Local public review', sources.length, 'published,', Object.keys(review.held).length, 'held', published.version);
  }
} finally { store.close(); }
