import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// The exercise uses the exact extraction offsets approved for Vercel's PDF.js.
process.env.DAI_TIN_PDF_ENGINE = 'pdfjs';
const { createPatentService } = await import('../patents/service.mjs');
const { loadPilotExercise } = await import('../patents/pilot-exercise.mjs');
const { hash } = await import('../copilot/m3/workflow.mjs');

const reviewer = { name: 'binh', role: 'reviewer', group: 'nhan-hieu' };
const peer = { ...reviewer, name: 'another-reviewer' };
const real = { synthetic: false, anonymized: true };
const call = (service, path, body, actor = reviewer) =>
  service.handle({ method: body === undefined ? 'GET' : 'POST' }, '/api/patents' + path, actor, async () => body);

test('guided exercise keeps the next task sealed until Word 1 and resumes the same locked case', async t => {
  const lock = JSON.parse(readFileSync(new URL('../patents/data/pilot-exercise/lock.json', import.meta.url)));
  const fixture = loadPilotExercise();
  let modelCalls = 0;
  const service = createPatentService({ storePath: ':memory:', approvedPilot: lock, model: async ({ matter, targets }) => {
    modelCalls++;
    return { patch: {
      ...(targets.includes('matrix') ? { matrix: { rows: [{
        feature: 'Hành trình tối thiểu của chốt', claimQuote: matter.claimText,
        d1Quote: matter.pinnedEvidence.find(pin => pin.record.id === matter.d1RecordIds[0]).record.text,
        d1RecordId: matter.d1RecordIds[0], assessment: 'different',
        analysis: 'Hai đoạn ghi ngưỡng hành trình tối thiểu khác nhau.', missing: 'Cần xác định vị trí đo.'
      }] } } : {}),
      response: { text: 'Đối chiếu đúng hai ngưỡng đã nêu trong đoạn chọn.', evidenceIds: matter.evidenceIds }
    }, run: { model: 'test', outcome: 'accepted' } };
  } });
  const other = createPatentService({ storePath: ':memory:', approvedPilot: { ...lock, manifestSha256: hash('other') } });
  t.after(() => { service.close(); other.close(); });

  assert.equal((await call(service, '/pilot-exercise', undefined, null)).status, 401);
  assert.equal((await call(service, '/pilot-exercise', undefined, peer)).status, 404);
  assert.equal((await call(other, '/pilot-exercise')).status, 404);
  assert.equal((await call(other, '/status')).value.pilotExercise, undefined);
  assert.equal((await call(service, '/status')).value.pilotExercise, true);
  const packet = (await call(service, '/pilot-exercise')).value;
  assert.deepEqual(Object.keys(packet).sort(), ['files', 'instructions', 'title']);
  assert.equal(packet.files.length, 3);
  for (const file of packet.files) assert.equal(hash(Buffer.from(file.content, 'base64')), lock.sources[file.role].sha256);
  assert.deepEqual((await call(service, '/cases')).value, []);

  const source = { ...real, documents: packet.files.map(({ role, content }) => ({ role, content })) };
  const inspected = (await call(service, '/pdf-pack/inspect', source)).value;
  const docs = source.documents.map(document => {
    const approved = lock.sources[document.role];
    const { pages } = inspected.documents.find(item => item.role === document.role);
    return { ...document, ...approved, label: document.role, confirmed: true,
      text: pages[0].text.slice(approved.start, approved.end) };
  });
  const input = { ...source, documents: docs, title: packet.title, instructionsText: packet.instructions,
    reference: lock.reference, asOf: lock.asOf, jurisdiction: 'VN' };
  assert.equal((await call(service, '/cases/pdf-pack', { ...input, documents: docs.map(d => ({ ...d, confirmed: false })) })).status, 422);
  const created = await call(service, '/cases/pdf-pack', input);
  assert.equal(created.status, 201);
  let matter = created.value;
  const path = '/cases/' + matter.id;
  assert.deepEqual(matter.pilotExercise, { phase: 1, task: fixture.firstTask });
  assert.deepEqual((await call(service, '/pilot-exercise')).value, { caseId: matter.id });
  const write = async (operation, body) => {
    const reply = await call(service, path + '/' + operation, { version: matter.version, ...body });
    assert.equal(reply.status ?? 200, 200);
    matter = reply.value;
  };
  await write('propose', { targets: ['matrix', 'response'], instruction: matter.pilotExercise.task });
  await write('approve', { targets: ['matrix'], reviewed: true });
  assert.equal(matter.pilotExercise.phase, 1);
  await write('approve', { targets: ['response'], reviewed: true });
  assert.deepEqual(matter.pilotExercise, { phase: 2, task: fixture.secondTask, instructions: fixture.revisionInstructions });
  const word1 = (await call(service, path + '/word/1')).value;
  const matrix = structuredClone(matter.sections.matrix);
  await write('propose', { targets: ['response'], instruction: matter.pilotExercise.task, instructionsText: matter.pilotExercise.instructions });
  await write('approve', { targets: ['response'], reviewed: true });
  assert.deepEqual(matter.pilotExercise, { phase: 3 });
  assert.deepEqual(matter.sections.matrix, matrix);
  assert.deepEqual((await call(service, path + '/word/1')).value, word1);
  assert.notDeepEqual((await call(service, path + '/word/2')).value, word1);
  assert.deepEqual((await call(service, '/pilot-exercise')).value, { caseId: matter.id });
  assert.equal((await call(service, '/cases')).value.length, 1);
  assert.equal(modelCalls, 2);
});
