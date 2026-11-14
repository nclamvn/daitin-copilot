export const pilotArms = ['chatbot', 'current'];
export const pilotOrder = id => Number(id.slice(1)) % 2 ? pilotArms : [...pilotArms].reverse();
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
};

export function reportPilot(state, decisions, { eligibleDays = 10 } = {}) {
  const entries = state.entries ?? [];
  const days = state.days ?? [];
  const valid = new Map(decisions.map(row => [row.code, row]));
  const pass = row => {
    const decision = valid.get(row.code);
    return Boolean(decision && !decision.critical && decision.correct && decision.evidence && decision.conditions && decision.usable);
  };
  const keys = [...new Set(entries.map(row => row.caseId))];
  const pairs = keys.map(id => pilotArms.map(arm => entries.find(row => row.caseId === id && row.arm === arm)))
    .filter(rows => rows.every(Boolean));
  const complete = pairs.filter(rows => rows.every(row => row.outcome !== 'done' || valid.has(row.code)));
  const matched = complete.filter(([product, baseline]) => pass(product) && pass(baseline) &&
    product.outcome === 'done' && baseline.outcome === 'done' && product.activeMs > 0 && baseline.activeMs > 0);
  const eligible = days.reduce((sum, day) => sum + day.eligible, 0);
  const used = days.reduce((sum, day) => sum + day.started, 0);
  const coverage = { comparable: complete.length, eligible, used, loggedDays: days.length, matched: matched.length,
    fellBack: entries.filter(row => row.outcome === 'fallback').length,
    dailyFallbacks: days.reduce((sum, day) => sum + day.fallback, 0) };
  const product = complete.filter(([row]) => pass(row) && row.outcome === 'done').length;
  const baseline = complete.filter(([, row]) => pass(row) && row.outcome === 'done').length;
  const critical = entries.filter(row => row.arm === 'chatbot' && valid.get(row.code)?.critical).length;
  const improvement = median(matched.map(([row, control]) => 1 - row.activeMs / control.activeMs));
  const adoption = eligible > 0 ? used / eligible : null;
  const stopping = entries.filter(row => row.outcome !== 'done');
  const gates = {
    quality: complete.length === 12 && product >= 11 && product >= baseline && critical === 0,
    time: matched.length >= 10 && improvement >= 0.25,
    adoption: days.length === eligibleDays && eligible > 0 && adoption >= 0.7,
  };
  return { coverage, product, baseline, critical, improvement, adoption, gates,
    stopped: stopping.map(({ caseId, arm, outcome, reason }) => ({ caseId, arm, outcome, reason })),
    passed: Object.values(gates).every(Boolean), entries: entries.map(({ draft, evidence, ...row }) => row), days };
}

export function blindPilot(entries, material) {
  return {
    submissions: entries.filter(row => row.outcome === 'done').map(row => ({
      code: row.code, caseId: row.caseId, ...(material?.[row.caseId] ? { caseMaterial: material[row.caseId] } : {}),
      client: row.draft.client, partner: row.draft.partner, evidence: row.evidence,
    })).sort((a, b) => a.code.localeCompare(b.code)),
  };
}
