import { DatabaseSync, backup } from 'node:sqlite';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../../advice/private/store.mjs';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Cần thư mục pilot công khai và đích mới.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const release = JSON.parse(readFileSync(resolve(source, 'release.json'), 'utf8'));
const policy = JSON.parse(readFileSync(resolve(root, 'advice/private/public-release.json'), 'utf8'));
const expected = Object.keys(policy.reviewed).map(id => id + '.docx').sort();
const db = new DatabaseSync(resolve(source, 'advice.sqlite'), { readOnly: true });
try {
  db.exec('BEGIN');
  const docs = db.prepare('SELECT sha,name,bytes FROM intake ORDER BY sha').all();
  const plans = db.prepare('SELECT data FROM pilot').all();
  const approvals = db.prepare('SELECT id,data,active FROM review ORDER BY id').all();
  const attempts = db.prepare('SELECT count(*) AS count FROM attempt').get().count;
  if (attempts !== 0) throw new Error('Đợt đã có phiên đo. Cần rà đầu ra người dùng trước khi chuyển.');
  if (JSON.stringify(docs.map(row => row.name).sort()) !== JSON.stringify(expected) ||
      JSON.stringify(docs.map(row => row.sha)) !== JSON.stringify(release.documents) ||
      docs.some(row => digest(row.bytes) !== row.sha) || plans.length !== 1) {
    throw new Error('Kho không khớp bảy tài liệu công khai đã khóa.');
  }
  const approved = approvals.map(row => JSON.parse(row.data));
  const plan = JSON.parse(plans[0].data);
  if (approvals.some(row => row.active !== 1) ||
      JSON.stringify(approvals.map(row => row.id)) !== JSON.stringify(release.approved) ||
      JSON.stringify(approved.map(row => row.title).sort()) !== JSON.stringify(expected) ||
      approved.some(row => !row.origin || row.simulated !== false) ||
      digest(JSON.stringify(approved)) !== release.version ||
      plan.id !== release.plan || plan.mode !== 'human' || plan.operator !== 'binh' || plan.grader !== 'cham-mu' ||
      plan.modelKey !== release.modelKey || plan.sourceHash !== release.sourceHash ||
      digest(JSON.stringify(plan.questions)) !== release.questionsHash ||
      JSON.stringify(plan.questions) !== JSON.stringify(policy.questions) ||
      JSON.stringify([...plan.sources].sort()) !== JSON.stringify(release.approved)) {
    throw new Error('Không thể giữ đúng khóa 6 câu, 7 đoạn và model.');
  }

  mkdirSync(destination, { mode: 0o700 });
  mkdirSync(resolve(destination, 'seed'), { mode: 0o700 });
  await backup(db, resolve(destination, 'seed/advice.sqlite'));
  writeFileSync(resolve(destination, 'seed/release.json'), JSON.stringify(release) + '\n', { mode: 0o600 });

  const paths = [
    'advice/private/app.css', 'advice/private/app.mjs', 'advice/private/index.html',
    'advice/private/pilot.mjs', 'advice/private/public-pilot-server.mjs', 'advice/private/store.mjs',
    'advice/library/answer.mjs', 'advice/library/model.mjs', 'advice/library/poa.mjs', 'advice/library/retrieval.mjs',
    'copilot/m5/access.mjs', 'copilot/m5/login.css', 'copilot/m5/login.html', 'copilot/m5/login.js',
    'copilot/model-connection.mjs', 'public/fonts.css', 'public/brand.css', 'public/brand/daitin.png',
    'web/security.mjs',
  ];
  for (const relative of paths) {
    const target = resolve(destination, 'app', relative);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(root, relative), target);
  }
  mkdirSync(resolve(destination, 'app/deploy'));
  copyFileSync(resolve(root, 'deploy/public-pilot/initialize.mjs'), resolve(destination, 'app/deploy/initialize.mjs'));
  for (const file of ['Dockerfile', 'start.sh']) {
    copyFileSync(resolve(root, 'deploy/public-pilot', file), resolve(destination, file));
  }
  console.log(JSON.stringify({ plan: release.plan, questions: plan.questions.length, documents: docs.length,
    attempts, model: release.modelKey, sourceHash: release.sourceHash, questionsHash: release.questionsHash,
    seedSha256: digest(readFileSync(resolve(destination, 'seed/advice.sqlite'))) }, null, 2));
} finally { db.close(); }
