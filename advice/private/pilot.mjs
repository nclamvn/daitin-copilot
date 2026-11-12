import { randomBytes } from 'node:crypto';
import { createIndex } from '../library/retrieval.mjs';
import { libraryAnswer } from '../library/answer.mjs';
import { bounded, digest, PrivateError } from './store.mjs';

const code = () => randomBytes(12).toString('hex');
const arms = ['copilot', 'direct'];
const errors = (message, status = 400) => { throw new PrivateError(message, status); };
const criteria = ['decision', 'citation', 'conditions', 'draft'];

export function createHumanPilot(store, model, modelKey, clock = Date.now, recoverAfterMs = 25000) {
  const { db, tx, audit } = store;
  const load = id => {
    const item = db.prepare('SELECT data FROM pilot WHERE id=?').get(id);
    if (!item) errors('Không tìm thấy đợt đo.', 404);
    return JSON.parse(item.data);
  };
  const attempts = id => db.prepare('SELECT data FROM attempt WHERE pilot=?').all(id).map(row => JSON.parse(row.data));
  const save = (plan, item) => db.prepare('INSERT INTO attempt VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
    .run(item.id, plan.id, JSON.stringify(item));
  const requireReviewer = actor => { if (actor.role !== 'reviewer') errors('Cần tài khoản luật sư.', 403); };
  const authorize = (plan, actor) => {
    if (![plan.operator, plan.grader, plan.createdBy].includes(actor.name)) errors('Tài khoản chưa được phân công đợt này.', 403);
  };
  const lock = plan => {
    if (!model || !modelKey || modelKey !== plan.modelKey) errors('Model đã đổi hoặc chưa sẵn sàng. Mở lại đợt đo.', 409);
    const published = store.publish();
    if (published.version !== plan.version) errors('Kho đã đổi. Tạo đợt mới để hai nhánh dùng cùng bộ nguồn.', 409);
    const rows = published.rows.filter(row => plan.sources.includes(row.id));
    if (digest(JSON.stringify(rows)) !== plan.sourceHash) errors('Bộ nguồn đợt đo đã đổi.', 409);
    return rows;
  };
  function stopActive(item, now) {
    if (item.phase === 'active') item.activeMs += Math.max(0, now - item.changedAt);
  }
  const operatorView = item => {
    const { blind, grade, ...view } = item;
    return view;
  };

  return {
    list(actor) {
      return db.prepare('SELECT data FROM pilot ORDER BY rowid DESC').all().map(row => JSON.parse(row.data))
        .filter(plan => [plan.operator, plan.grader, plan.createdBy].includes(actor.name))
        .map(({ id, title, operator, grader, mode }) => ({ id, title, operator, grader, mode }));
    },
    create(body, actor) {
      requireReviewer(actor);
      if (!model || !modelKey) errors('Khởi động cùng model cục bộ trước khi tạo đợt đo.', 409);
      const operator = bounded(body.operator, 30);
      const grader = bounded(body.grader, 30);
      if (!/^[a-z][a-z0-9-]{0,29}$/.test(operator) || !/^[a-z][a-z0-9-]{0,29}$/.test(grader) || operator === grader) {
        errors('Cần hai tài khoản riêng cho người thao tác và người chấm.');
      }
      if (!['human', 'simulation'].includes(body.mode)) errors('Chọn loại đợt đo.');
      if (!Array.isArray(body.questions) || !body.questions.length || body.questions.length > 12) errors('Cần từ 1 đến 12 câu hỏi.');
      const questions = body.questions.map(query => bounded(query, 400, 8));
      if (new Set(questions).size !== questions.length) errors('Câu hỏi trùng nhau.');
      const published = store.publish();
      if (!Array.isArray(body.sources) || !body.sources.length || body.sources.length > 12 ||
          new Set(body.sources).size !== body.sources.length) errors('Chọn từ 1 đến 12 đoạn đã duyệt.');
      const rows = published.rows.filter(row => body.sources.includes(row.id));
      if (rows.length !== body.sources.length) errors('Chỉ chọn đoạn đang được duyệt.');
      if (rows.some(row => row.supersedes.some(id => !body.sources.includes(id)))) errors('Chọn kèm phiên bản được thay thế để đối chiếu.');
      if (rows.reduce((sum, row) => sum + row.quote.length, 0) > 11000) errors('Bộ đoạn vượt cửa sổ so sánh của model. Hãy chọn bộ nhỏ hơn.');
      const plan = { id: code(), title: bounded(body.title, 160), operator, grader, mode: body.mode, createdBy: actor.name,
        version: published.version, sourceHash: digest(JSON.stringify(rows)), sources: rows.map(row => row.id), modelKey, questions };
      tx(() => {
        db.prepare('INSERT INTO pilot VALUES(?,?)').run(plan.id, JSON.stringify(plan));
        audit('pilot-locked', actor.name, plan.id, { version: plan.version, sourceHash: plan.sourceHash, modelKey, mode: plan.mode });
      });
      return { id: plan.id };
    },
    detail(id, actor) {
      const plan = load(id);
      authorize(plan, actor);
      if (actor.name !== plan.operator) return { id, title: plan.title, grader: plan.grader, mode: plan.mode, canGrade: actor.name === plan.grader };
      return { ...plan, recoverySeconds: Math.ceil(recoverAfterMs / 1000), attempts: attempts(id).map(operatorView) };
    },
    async act(id, body, actor) {
      const plan = load(id);
      if (actor.name !== plan.operator) errors('Chỉ người thao tác được phân công mới được ghi phiên.', 403);
      const rows = lock(plan);
      const i = body.caseIndex;
      const arm = body.arm;
      if (!Number.isSafeInteger(i) || i < 0 || i >= plan.questions.length || !arms.includes(arm)) errors('Mã ca hoặc nhánh không hợp lệ.');
      const attemptId = id + '-' + i + '-' + arm;
      const time = clock();
      const step = tx(() => {
        const all = attempts(id);
        let item = all.find(row => row.id === attemptId);
        if (body.action === 'start') {
          if (item) return { item };
          const first = i % 2 ? 'direct' : 'copilot';
          if (arm !== first && !all.some(row => row.caseIndex === i && row.arm === first && row.phase === 'complete')) {
            errors('Hoàn tất nhánh được xếp trước của ca này.', 409);
          }
          if (all.some(row => ['active', 'waiting'].includes(row.phase))) errors('Tạm dừng phiên đang chạy trước khi đổi nhánh.', 409);
          if (plan.mode === 'human' && body.operatorConfirmed !== true) errors('Xác nhận người được phân công đang trực tiếp thao tác.');
          item = { id: attemptId, blind: code(), caseIndex: i, arm, phase: 'active', changedAt: time, activeMs: 0, waitingMs: 0 };
        } else {
          if (!item) errors('Bắt đầu đồng hồ của phiên trước.');
          if (body.action === 'recover' && item.phase === 'waiting' && time - item.changedAt > recoverAfterMs) {
            item.waitingMs += recoverAfterMs;
            item.phase = 'paused';
          } else if (body.action === 'resume' && item.phase === 'paused') {
            if (all.some(row => row.id !== item.id && ['active', 'waiting'].includes(row.phase))) errors('Tạm dừng phiên đang chạy trước khi đổi nhánh.', 409);
            item.phase = 'active';
          } else if (body.action === 'pause' && item.phase === 'active') {
            stopActive(item, time);
            item.phase = 'paused';
          } else if (body.action === 'generate' && item.phase === 'active' && !item.output) {
            stopActive(item, time);
            item.phase = 'waiting';
          } else if (body.action === 'finish' && item.phase === 'active' && item.output) {
            if (plan.mode === 'human' && body.operatorConfirmed !== true) errors('Xác nhận chính người thao tác đã rà bản trả lời.');
            const citations = body.citations ?? [];
            if (!Array.isArray(citations) || citations.length > 12 || !citations.every(key => rows.some(row => row.id === key))) {
              errors('Bản đã rà chứa mã đoạn ngoài bộ nguồn.');
            }
            stopActive(item, time);
            item.phase = 'complete';
            item.final = { answer: bounded(body.answer, 8000), email: body.email ? bounded(body.email, 8000) : '',
              citations: [...new Set(citations)] };
          } else errors('Bước này không khớp trạng thái của đồng hồ.', 409);
          item.changedAt = time;
        }
        save(plan, item);
        audit('pilot-' + body.action, actor.name, attemptId, { phase: item.phase });
        return { item, generate: body.action === 'generate' };
      });
      if (!step.generate) return operatorView(step.item);
      const query = plan.questions[i];
      let output;
      let failure;
      try {
        if (arm === 'copilot') {
          const index = createIndex({ schema: 1, simulation: false, rows }, { privateLibrary: true });
          const answer = await libraryAnswer(index, query, 'library', model, { simulation: false, measure: true });
          if (!answer.run) throw new Error('Model chưa trả kết quả.');
          output = { answer: [answer.title, answer.body, ...answer.notes].join('\n\n'), email: answer.email,
            citations: answer.citations.map(row => row.id), kind: answer.kind, elapsedMs: answer.run.elapsedMs };
        } else {
          const answer = await model(query, rows);
          output = { answer: answer.answer, email: answer.email, citations: answer.ids.filter(key => rows.some(row => row.id === key)),
            kind: answer.status, elapsedMs: answer.elapsedMs };
        }
        lock(plan);
      } catch {
        failure = 'Lượt model chưa hoàn tất hoặc kho đã đổi. Kiểm cấu hình rồi tiếp tục.';
        output = undefined;
      }
      return tx(() => {
        const current = attempts(id).find(row => row.id === attemptId);
        if (current.phase !== 'waiting' || current.changedAt !== time) errors('Phiên đã chuyển trạng thái.', 409);
        current.waitingMs += Math.max(0, clock() - current.changedAt);
        current.phase = 'paused';
        current.changedAt = clock();
        current.output = output;
        current.error = failure;
        save(plan, current);
        audit('pilot-model-finished', actor.name, attemptId, { success: Boolean(output) });
        return operatorView(current);
      });
    },
    source(id, actor, sourceId) {
      const plan = load(id);
      authorize(plan, actor);
      const row = lock(plan).find(item => item.id === sourceId);
      if (!row) errors('Đoạn nằm ngoài bộ nguồn đã khóa.', 404);
      return { id: row.id, title: row.title, quote: row.quote, paragraph: row.paragraph, date: row.date,
        origin: row.origin, locator: row.locator };
    },
    blind(id, actor) {
      const plan = load(id);
      if (actor.name !== plan.grader || actor.role !== 'reviewer') errors('Cần tài khoản người chấm độc lập.', 403);
      const source = lock(plan);
      const runs = attempts(id);
      if (runs.length !== plan.questions.length * 2 || runs.some(row => row.phase !== 'complete')) errors('Chờ người thao tác hoàn tất hai nhánh.', 409);
      return { title: plan.title, criteria, sources: source.map(({ id, title, quote, paragraph, date, origin, locator }) => ({ id, title, quote, paragraph, date, origin, locator })),
        cases: runs.map(row => ({ code: row.blind, question: plan.questions[row.caseIndex], ...row.final }))
          .sort((a, b) => a.code.localeCompare(b.code)) };
    },
    grade(id, body, actor) {
      const plan = load(id);
      this.blind(id, actor);
      const initial = attempts(id);
      if (!Array.isArray(body?.grades) || body.grades.length !== initial.length) errors('Cần chấm đủ mã ẩn danh.');
      const byCode = new Map(body.grades.map(row => [row?.code, row]));
      if (byCode.size !== initial.length) errors('Mã chấm trùng.');
      return tx(() => {
        for (const row of attempts(id)) {
          if (row.grade) errors('Đợt này đã khóa phiếu chấm.', 409);
          const grade = byCode.get(row.blind);
          if (!grade || criteria.some(key => typeof grade[key] !== 'boolean')) errors('Mỗi mã cần đủ bốn tiêu chí đúng hoặc sai.');
          row.grade = Object.fromEntries(criteria.map(key => [key, grade[key]]));
          row.grade.note = grade.note ? bounded(grade.note, 3000) : '';
          save(plan, row);
        }
        audit('pilot-graded', actor.name, id);
        return { recorded: true };
      });
    },
    report(id, actor) {
      const plan = load(id);
      authorize(plan, actor);
      if (actor.name !== plan.createdBy && actor.name !== plan.operator) errors('Phiếu chấm mù không hiển thị nhánh.', 403);
      const runs = attempts(id);
      if (runs.length !== plan.questions.length * 2 || runs.some(row => !row.grade)) errors('Chưa đủ phiên và phiếu chấm để công bố.', 409);
      const passed = row => criteria.every(key => row.grade[key]);
      const paired = plan.questions.map((_, i) => i).filter(i => runs.filter(row => row.caseIndex === i).every(passed));
      const summary = arms.map(arm => {
        const branch = runs.filter(row => row.arm === arm);
        const sum = (list, key) => list.reduce((total, row) => total + row[key], 0);
        return { arm, count: branch.length, passed: branch.filter(passed).length,
          activeMs: sum(branch, 'activeMs'), waitingMs: sum(branch, 'waitingMs'),
          pairedActiveMs: sum(branch.filter(row => paired.includes(row.caseIndex)), 'activeMs') };
      });
      return { mode: plan.mode, model: plan.modelKey, sourceHash: plan.sourceHash, paired: paired.length, summary,
        cases: runs.map(({ caseIndex, arm, activeMs, waitingMs, grade }) => ({ caseIndex, arm, activeMs, waitingMs, grade })) };
    },
  };
}
