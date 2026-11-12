import { readFileSync } from 'node:fs';
import { hash } from '../copilot/m3/workflow.mjs';
import { parsePilotLock, patentPDFRoles, pilotLockDigest } from './pilot-lock.mjs';
import { maxPatentPDFBytes } from './intake.mjs';
import { pdfEngine } from '../copilot/m4/pdf.mjs';

const directory = new URL('./data/pilot-exercise/', import.meta.url);
let verified;

export function loadPilotExercise() {
  if (verified) return verified;
  const manifestBytes = readFileSync(new URL('manifest.json', directory));
  const { version, synthetic, anonymized, cases } = JSON.parse(manifestBytes);
  const lock = parsePilotLock(readFileSync(new URL('lock.json', directory), 'utf8'));
  const entry = cases?.[0];
  if (version !== 1 || synthetic !== false || anonymized !== true || cases?.length !== 1 ||
      hash(manifestBytes) !== lock.manifestSha256 || entry.reference !== lock.reference || entry.asOf !== lock.asOf) {
    throw new Error('Bộ diễn tập sáng chế không khớp khóa nguồn.');
  }
  for (const [key, max] of Object.entries({ title: 160, instructions: 6000, phase1Task: 600, phase2Task: 600, phase2Instructions: 6000 })) {
    if (typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > max) {
      throw new Error('Thiếu thông tin diễn tập sáng chế hợp lệ.');
    }
  }
  const files = patentPDFRoles.map(role => {
    const document = entry[role], source = lock.sources[role];
    if (!/^0[1-3]-[a-zA-Z0-9-]+\.pdf$/.test(document?.file ?? '') ||
        document.sha256 !== source.sha256 || document.page !== source.page ||
        typeof document.quote !== 'string' || document.quote.length !== source.end - source.start ||
        hash(document.quote) !== source.textSha256) {
      throw new Error('Nguồn diễn tập không khớp trang và đoạn đã khóa.');
    }
    const bytes = readFileSync(new URL(document.file, directory));
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-' || hash(bytes) !== source.sha256) {
      throw new Error('Bản PDF diễn tập không khớp dấu kiểm.');
    }
    return { role, name: document.file, bytes };
  });
  if (files.reduce((total, file) => total + file.bytes.length, 0) > maxPatentPDFBytes) {
    throw new Error('Bộ diễn tập vượt giới hạn nhập PDF.');
  }
  verified = { reference: lock.reference, lockDigest: pilotLockDigest(lock), title: entry.title,
    initialInstructions: entry.instructions, firstTask: entry.phase1Task,
    secondTask: entry.phase2Task, revisionInstructions: entry.phase2Instructions, files };
  return verified;
}

export function exerciseForLock(lock) {
  if (pdfEngine !== 'pdfjs' || !lock || lock.reference !== 'PAT-DT-PILOT-S01') return null;
  const exercise = loadPilotExercise();
  return pilotLockDigest(lock) === exercise.lockDigest ? exercise : null;
}

export function exerciseCaseView(matter, exercise) {
  if (!exercise || matter.pilotLockSha256 !== exercise.lockDigest) return matter;
  const phase = Math.min(matter.releases.length + 1, 3);
  const guidance = phase === 1 ? { task: exercise.firstTask } : phase === 2
    ? { task: exercise.secondTask, instructions: exercise.revisionInstructions } : {};
  return { ...matter, pilotExercise: { phase, ...guidance } };
}
