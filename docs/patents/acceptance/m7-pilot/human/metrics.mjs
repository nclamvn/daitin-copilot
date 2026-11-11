import assert from 'node:assert/strict';

const workStages = new Set(['source', 'reopen', 'draft', 'review', 'edit', 'approve', 'export']);
const paused = new Set(['wait', 'pause']);
const stages = new Set([...workStages, ...paused]);

export function observerReceipt(record, expected) {
  assert.equal(record.version, 1);
  assert.ok(['observer_stopwatch','operator_stopwatch'].includes(record.method));
  for (const key of ['caseId', 'arm', 'phase']) assert.equal(record[key], expected[key]);
  const begin = Date.parse(record.startedAt), end = Date.parse(record.endedAt);
  assert.ok(Number.isFinite(begin) && end >= begin);
  assert.ok(Array.isArray(record.segments) && record.segments.length > 0 && record.segments.length <= 10000);
  assert.ok(Array.isArray(record.actions) && record.actions.length <= 10000);
  const times = { activeMs: 0, waitMs: 0, pauseMs: 0 };
  let position = 0;
  for (const segment of record.segments) {
    assert.ok(stages.has(segment.stage) && segment.startMs === position);
    assert.ok(Number.isSafeInteger(segment.endMs) && segment.endMs >= position);
    const key = workStages.has(segment.stage) ? 'activeMs' : segment.stage + 'Ms';
    times[key] += segment.endMs - position;
    position = segment.endMs;
  }
  assert.ok(position === record.totalMs && times.activeMs > 0);
  let actionAt = 0;
  let index = 0;
  for (const action of record.actions) {
    assert.ok(workStages.has(action.stage));
    assert.ok(Number.isSafeInteger(action.atMs) && action.atMs >= actionAt && action.atMs <= position);
    while (index < record.segments.length - 1 && action.atMs > record.segments[index].endMs) index++;
    // Boundary offsets can be shared when the clock rounds to a millisecond.
    assert.ok(record.segments.slice(index).some(segment => segment.startMs <= action.atMs &&
      segment.endMs >= action.atMs && segment.stage === action.stage));
    actionAt = action.atMs;
  }
  return { ...times, elapsedMs: position, actions: record.actions.length, method: record.method,
    startedAt: record.startedAt, endedAt: record.endedAt };
}

export function pairedEffort(records, caseId) {
  assert.equal(records.length, 4);
  const result = {};
  for (const arm of ['product', 'direct']) {
    const phases = {};
    for (const phase of [1, 2]) {
      const matches = records.filter(row => row.arm === arm && row.phase === phase);
      assert.equal(matches.length, 1);
      phases[phase] = observerReceipt(matches[0], { caseId, arm, phase });
    }
    assert.ok(Date.parse(phases[2].startedAt) >= Date.parse(phases[1].endedAt), 'Session 2 started before session 1 ended');
    const total = Object.fromEntries(['activeMs', 'waitMs', 'pauseMs', 'elapsedMs', 'actions']
      .map(key => [key, phases[1][key] + phases[2][key]]));
    result[arm] = { phases, total };
  }
  const order = records.toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const [index, row] of order.entries()) {
    assert.equal(row.phase, index < 2 ? 1 : 2, 'Finish both first sessions before revealing the revision');
    if (index) assert.ok(Date.parse(row.startedAt) >= Date.parse(order[index - 1].endedAt),
      'The same operator cannot work on both branches at once');
  }
  return {
    ...result,
    order: order.map(({ arm, phase }) => ({ arm, phase })),
    activeMsSaved: result.direct.total.activeMs - result.product.total.activeMs,
    actionsSaved: result.direct.total.actions - result.product.total.actions
  };
}
