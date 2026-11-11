import { normalize, bodyCitation, retainsPrevious } from './actor.mjs';

export const rubricVersion = 'm5-blind-rubric-1';
export function guard(entry, packet, registry) {
  const checks = {};
  const artifact = packet.artifact;
  if (!artifact) return { status: 'unscored', checks: { artifact: false }, critical: true, notes: ['Thiếu đầu ra.'] };
  if (packet.type === 'answer') {
    const expected = entry.expected;
    checks.disposition = artifact.status === expected.status;
    checks.form = (artifact.form?.id ?? null) === expected.form;
    checks.evidence = !expected.evidence || artifact.citations.some(item => item.id === expected.evidence);
    checks.citationIntegrity = artifact.citations.every(item => {
      const original = registry.provisions[item.id];
      const doc = original && registry.documents[original.document];
      return doc && item.page === original.page && item.locator === original.locator &&
        item.document === doc.number && item.sha256 === doc.sha256 && item.originalUrl === doc.url + '#page=' + original.page;
    });
    if (artifact.form) {
      const original = registry.forms[artifact.form.id];
      const doc = original && registry.documents[original.document];
      checks.formIntegrity = Boolean(doc && artifact.form.document === doc.number && artifact.form.page === original.page &&
        artifact.form.number === original.number && artifact.form.sha256 === doc.sha256);
    }
    if (['grounded', 'historical'].includes(expected.status)) {
      checks.applicableDate = artifact.applicableOn === (entry.request.mode === 'case' ? entry.request.receivedOn : entry.request.asOf);
    }
    if (['S01', 'S02', 'S03'].includes(entry.id)) {
      checks.missingFact = artifact.missing.includes({ S01: 'asOf', S02: 'receivedOn', S03: 'pendingAtCutover' }[entry.id]);
    }
    if (entry.id === 'S07') {
      checks.designations = JSON.stringify(artifact.referral?.targets?.map(item => item.code)) === '["VN","TH"]' &&
        artifact.referral.targets.every(item => item.status === 'Chưa xác minh');
      checks.officialReferral = /^https:\/\/www\.wipo\.int\//.test(artifact.referral?.url ?? '');
    }
  } else {
    const s = artifact.sections;
    const intended = packet.phase === 1 ? entry.first : entry.next;
    const old = entry.notice.text.match(/"([^"]+)"/u)?.[1];
    checks.caseMetadata = normalize(artifact.metadata).includes(normalize(entry.reference)) &&
      normalize(artifact.metadata).includes(normalize(entry.title));
    checks.releaseVersion = normalize(artifact.metadata).includes('bản duyệt nội bộ ' + packet.phase);
    checks.findings = normalize(s.findings).includes(normalize(old));
    checks.updatedTerm = normalize(s.response).includes(normalize(intended));
    checks.noStaleTerm = packet.phase !== 2 || !retainsPrevious(s.response, entry.first, entry.next);
    checks.attachments = normalize(s.attachments).includes(normalize(entry.attachment)) && normalize(s.attachments).includes('dự kiến');
    checks.legalLocator = normalize(s.legal).includes('điều 83 khoản 2 điểm b') &&
      normalize(s.legal).includes('10/2026/tt-bkhcn') && normalize(s.legal).includes('trang pdf 102');
    const transition = entry.facts.receivedOn < registry.cutover && entry.facts.asOf >= registry.cutover;
    checks.transition = !transition || ['điều 17 khoản 2', 'điều 18 khoản 2', '20/2026/tt-bkhcn', 'trang pdf 14']
      .every(text => normalize(s.legal).includes(text));
    checks.noInventedLegal = !bodyCitation.test([s.findings, s.response, s.attachments].join(' '));
    checks.noHold = !normalize([s.findings, s.response, s.attachments].join(' ')).includes('[luật sư xác nhận]');
    checks.editableBrand = Boolean(artifact.editable && artifact.brand);
  }
  const failures = Object.keys(checks).filter(key => !checks[key]);
  return { status: failures.length ? 'check' : 'pass', checks, critical: failures.length > 0, notes: failures };
}

export function canaries(packets, fixtures) {
  const cases = new Map(fixtures.map(item => [item.id, item]));
  const baseWord = packets.find(item => item.case === 'W01' && item.phase === 2 && item.artifact);
  const baseRenew = packets.find(item => item.case === 'Q03' && item.artifact);
  const baseMadrid = packets.find(item => item.case === 'S07' && item.artifact);
  const tests = [];
  function inject(name, packet, mutate) {
    if (!packet) return;
    const fake = structuredClone(packet);
    mutate(fake.artifact, cases.get(fake.case));
    fake.code = name;
    tests.push(fake);
  }
  inject('C-STALE-GOODS', baseWord, (a, e) => { a.sections.response = 'Đề nghị dùng "' + e.first + '".'; });
  inject('C-WRONG-ARTICLE', baseWord, a => { a.sections.legal = a.sections.legal.replace('83', '999'); });
  inject('C-WRONG-RELEASE', baseWord, a => { a.metadata = a.metadata.replace(/nội bộ\s+2/u, 'nội bộ 9'); });
  inject('C-FABRICATED-LEGAL', baseWord, a => { a.sections.response += ' Theo Điều 999 khoản 8.'; });
  inject('C-WRONG-FORM', baseRenew, a => { a.form.id = 'renewal-tt10-02'; });
  inject('C-MADRID-GRANTED', baseMadrid, a => { a.referral.targets[1].status = 'Đã được bảo hộ'; });
  return tests;
}
