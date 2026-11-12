import assert from 'node:assert/strict';
import { existsSync, linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { modelConnection } from '../../../../copilot/model-connection.mjs';
import { inspectPatentPDF } from '../../../../patents/intake.mjs';
import { parsePilotLock, pilotLockDigest } from '../../../../patents/pilot-lock.mjs';
import { buildPatentPrompt, materializePatentSpans, privateEvidence } from '../../../../patents/workflow.mjs';
import { makePatentWordV2, patentWordRendererV2 } from '../../../../patents/word.mjs';
import { beginModel, directory, measure, modelId, openLedger, qualityView, readJSON, sha, timestamp, track, verifyLockedDocuments, writeJSON } from './common.mjs';
import { approveDirectDraft, HumanPilotError } from './direct-human.mjs';

const casePath = (out, entry, phase) => join(out, 'direct-workspace', `${entry.id}-session-${phase}.json`);
const wordPath = (out, entry, phase) => join(out, 'direct-word', `${entry.id}-v${phase}.docx`);
const docRole = role => role === 'notice' ? 'case:notice' : 'pdf-' + role;
const paceMs = 15000;
class RateLimitPause extends Error {}

function cachedProviderOutput(ledger, entry, phase, stage, file) {
  const output = readJSON(file);
  if (entry.anonymized) {
    const receipt = ledger.state.modelAttempts.findLast(item => item.caseId === entry.id &&
      item.phase === phase && item.stage === stage);
    if (receipt?.status !== 'accepted' || receipt.pilotLockSha256 !== ledger.state.pilotLockSha256 ||
        receipt.cacheSha256 !== sha(JSON.stringify(output))) {
      throw new HumanPilotError('Không xác minh được bản đã lưu của model. Giữ nguyên thư mục để kiểm tra; chưa gửi lại.');
    }
  }
  return output;
}

async function providerCall(ledger, connection, entry, phase, stage, payload, parse, file, fetcher = fetch) {
  const retry429 = process.env.DAITIN_PILOT_RETRY_429 === '1';
  const attempts = ledger.state.modelAttempts;
  const history = attempts.filter(item => item.caseId === entry.id && item.phase === phase && item.stage === stage);
  if (history.length && !(retry429 && history.length === 1 && history[0].providerStatus === 429 && history[0].status === 'failed_or_uncertain')) {
    throw new Error(`Previous ${stage} attempt exists for ${entry.id} phase ${phase}; no provider replay`);
  }
  const last = attempts.at(-1);
  const elapsed = last ? Date.now() - Date.parse(last.attemptedAt) : paceMs;
  const waitMs = Math.max(0, paceMs - elapsed);
  if (waitMs) await measure(ledger, 'pacing', entry.id, phase, 'space provider requests', () => pause(waitMs));
  const receipt = beginModel(ledger, entry.id, phase, stage, 32, { retry429 });
  const serialized = JSON.stringify(payload);
  receipt.inputSha256 = sha(serialized);
  ledger.save();
  const start = performance.now();
  try {
    const response = await fetcher(connection.endpoint, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await connection.credential() },
      body: serialized, signal: AbortSignal.timeout(60000) });
    receipt.providerStatus = response.status;
    if (!response.ok) {
      receipt.retryAfter = response.headers.get('retry-after');
      const result = await response.json().catch(() => null);
      const code = result?.error?.code ?? result?.error?.type;
      if ((typeof code === 'number' || typeof code === 'string') && /^[A-Za-z0-9_.-]{1,80}$/.test(String(code))) receipt.errorCode = code;
      if (response.status === 429) throw new RateLimitPause('Provider HTTP 429; pause for operator cooldown');
      throw new Error(`Provider HTTP ${response.status}`);
    }
    const result = await response.json();
    const choice = result.choices?.[0];
    receipt.promptTokens = result.usage?.prompt_tokens ?? null;
    receipt.completionTokens = result.usage?.completion_tokens ?? null;
    receipt.finishReason = choice?.finish_reason ?? null;
    receipt.outputSha256 = sha(JSON.stringify(choice?.message ?? null));
    const value = parse(choice);
    if (file) {
      writeJSON(file, value);
      if (entry.anonymized) receipt.cacheSha256 = sha(JSON.stringify(value));
    }
    receipt.status = 'accepted';
    if (stage === 'select_tool') receipt.toolCallId = value.toolCallId;
    return value;
  } catch (error) {
    receipt.status = 'failed_or_uncertain';
    receipt.error = entry.anonymized ? 'provider_or_output_error' : error.message;
    throw error;
  } finally {
    receipt.elapsedMs = Math.round(performance.now() - start);
    ledger.save();
  }
}

async function selectReadTool(ledger, connection, out, entry, phase, task, fetcher) {
  const file = join(out, 'direct-workspace', `${entry.id}-tool-${phase}.json`);
  if (existsSync(file)) {
    const value = cachedProviderOutput(ledger, entry, phase, 'select_tool', file);
    assert.equal(value.caseId, entry.id);
    assert.equal(value.phase, phase);
    return value;
  }
  const payload = {
    model: connection.model, temperature: 0, seed: 42, max_tokens: 400, stream: false,
    messages: [{ role: 'system', content: 'Bạn là agent hỗ trợ đối chiếu sáng chế. Tệp của hồ sơ và bản đã duyệt được lưu trong workspace. Hãy gọi công cụ read_case đúng một lần để nạp tài liệu và trạng thái trước khi soạn. Chỉ thực hiện tool call trong lượt này.' },
      { role: 'user', content: JSON.stringify({ caseId: entry.id, phase, task }) }],
    tools: [{ type: 'function', function: { name: 'read_case', description: 'Read the selected PDF evidence and recover this case session from the local workspace.',
      parameters: { type: 'object', additionalProperties: false, required: ['caseId', 'phase'], properties: { caseId: { type: 'string' }, phase: { type: 'integer' } } } } }]
  };
  return providerCall(ledger, connection, entry, phase, 'select_tool', payload, choice => {
    assert.equal(choice?.message?.tool_calls?.length, 1, 'Agent must select exactly one tool');
    const call = choice.message.tool_calls[0];
    assert.equal(call.function.name, 'read_case');
    const args = JSON.parse(call.function.arguments);
    assert.deepEqual(args, { caseId: entry.id, phase }, 'Agent requested a different case or phase');
    assert.ok(typeof call.id === 'string' && call.id, 'Provider tool call ID is missing');
    return { caseId: entry.id, phase, tool: 'read_case', toolCallId: call.id };
  }, file, fetcher);
}

async function inspectLockedPage(entry, document) {
  const bytes = readFileSync(document.path);
  assert.equal(sha(bytes), document.sha256);
  const pdf = await inspectPatentPDF({
    synthetic: true,
    firstPage: document.page, lastPage: document.page, content: bytes.toString('base64')
  });
  assert.equal(pdf.sha256, document.sha256);
  const page = pdf.pages[0];
  assert.equal(page.page, document.page);
  const start = page.text.indexOf(document.quote);
  assert.ok(page.usable && start >= 0 && page.text.indexOf(document.quote, start + 1) === -1,
    `Direct agent could not verify exact excerpt ${entry.id}/${document.role}`);
  return { bytes, pdf, start };
}

async function inspectHumanDocuments(entry) {
  if (!entry.anonymized) throw new HumanPilotError('Manifest chưa được khai báo là bộ hồ sơ ẩn danh.');
  const { inspectWithPDFJS } = await import('../../../../copilot/m4/pdf-js.mjs');
  const documents = [];
  for (const document of entry.documents) {
    try {
      const source = entry[document.role];
      assert.ok(['sha256', 'page', 'start', 'end', 'quote', 'label'].every(key => document[key] === source[key]));
      const bytes = readFileSync(document.path);
      assert.equal(sha(bytes), document.sha256);
      const pages = await inspectWithPDFJS(bytes);
      const page = pages[document.page - 1];
      assert.equal(page?.page, document.page);
      assert.ok([page.text, document.quote].every(text => text.trim() && text.isWellFormed() &&
        !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD-\uFFFF]/u.test(text)));
      const start = document.start ?? page.text.indexOf(document.quote);
      const end = document.end ?? start + document.quote.length;
      assert.ok(start >= 0 && end === start + document.quote.length && page.text.slice(start, end) === document.quote);
      assert.ok(document.start !== undefined || page.text.indexOf(document.quote, start + 1) === -1);
      documents.push({ bytes, metadata: { recordId: docRole(document.role), role: document.role, label: document.label,
        sha256: document.sha256, page: document.page, pageCount: pages.length, start, end,
        textSha256: sha(document.quote), extractionEngine: 'pdfjs' } });
    } catch {
      throw new HumanPilotError('PDF, trang hoặc đoạn đã khóa không khớp ở ' + entry.id + '/' + document.role + '.');
    }
  }
  return documents;
}

export async function verifyHumanSources(input) {
  let count = 0;
  for (const entry of input.cases) count += (await inspectHumanDocuments(entry)).length;
  return count;
}

export async function deriveHumanSourceLock(input, approved) {
  if (input.cases.length !== 1) throw new HumanPilotError('Pilot với luật sư đăng ký đúng một hồ sơ.');
  const [entry] = input.cases;
  const { reference, asOf } = entry;
  const { manifestSha256 } = input;
  if (approved && (approved.manifestSha256 !== manifestSha256 || approved.reference !== reference || approved.asOf !== asOf)) {
    throw new HumanPilotError('Manifest, mã hồ sơ hoặc ngày đối chiếu không khớp bản khóa đã duyệt.');
  }
  const documents = await inspectHumanDocuments(entry);
  const sources = Object.fromEntries(documents.map(({ metadata: { role, sha256, page, start, end, textSha256 } }) =>
    [role, { sha256, page, start, end, textSha256 }]));
  const lock = parsePilotLock({ version: 1, manifestSha256, reference, asOf, sources });
  if (approved) {
    try { verifyLockedDocuments(documents.map(item => item.metadata), approved); }
    catch { throw new HumanPilotError('PDF, trang hoặc đoạn trích không khớp bản khóa đã duyệt.'); }
  }
  return { lock, documents };
}

const savedPDF = (out, entry, role) => join(out, 'direct-workspace', `${entry.id}-${role}.pdf`);

async function extractSource(ledger, entry, document, out) {
  const { bytes, pdf, start } = await measure(ledger, 'tool', entry.id, 1, 'extract selected PDF range',
    () => inspectLockedPage(entry, document), ({ pdf }) => ({ extractionEngine: pdf.extractionEngine, role: document.role }));
  const originalPath = savedPDF(out, entry, document.role);
  if (existsSync(originalPath)) assert.equal(sha(readFileSync(originalPath)), document.sha256);
  else writeFileSync(originalPath, bytes, { mode: 0o600, flag: 'wx' });
  const metadata = { recordId: docRole(document.role), role: document.role, label: document.label, sha256: document.sha256,
    page: document.page, pageCount: pdf.pageCount, start, end: start + document.quote.length,
    textSha256: sha(document.quote), extractionEngine: pdf.extractionEngine };
  return metadata;
}

function pinnedSource(document, metadata) {
  const sourceId = 'local-document-' + document.role;
  const textFidelity = 'pdf_text_user_confirmed';
  return {
    source: { id: sourceId, kind: 'case_document', title: document.label, sha256: document.sha256, url: null,
      authority: 'PDF riêng của hồ sơ', jurisdiction: null, textFidelity, reviewStatus: 'excerpt_confirmed_by_operator' },
    record: { id: metadata.recordId, sourceId, kind: 'patent', title: document.label, text: document.quote, jurisdiction: null,
      locator: { page: document.page, section: document.role === 'claim' ? 'claim' : 'description', label: 'Trang PDF ' + document.page },
      provenance: 'case_pdf_excerpt', textFidelity }
  };
}

async function executeReadTool(ledger, out, entry, phase, tool, verified, baseline) {
  return measure(ledger, 'tool', entry.id, phase, 'execute read_case', async () => {
    if (phase === 2) {
      const prior = baseline ?? readJSON(casePath(out, entry, 1));
      if (!baseline) {
        for (const document of entry.documents) {
          const original = readFileSync(savedPDF(out, entry, document.role));
          assert.equal(sha(original), document.sha256);
          assert.ok(prior.documents.some(saved => saved.role === document.role && saved.sha256 === document.sha256 &&
            saved.page === document.page && saved.textSha256 === sha(document.quote)));
        }
      }
      prior.instructionsText = entry.phase2Instructions;
      prior.sections.response.approval = null;
      return prior;
    }
    const documents = [];
    const pinnedEvidence = [];
    for (const [index, document] of entry.documents.entries()) {
      const checked = verified?.[index];
      const metadata = checked?.metadata ?? await extractSource(ledger, entry, document, out);
      if (checked) {
        const original = savedPDF(out, entry, document.role);
        if (existsSync(original)) assert.equal(sha(readFileSync(original)), metadata.sha256);
        else writeFileSync(original, checked.bytes, { mode: 0o600, flag: 'wx' });
      }
      documents.push(metadata);
      if (document.role !== 'notice') pinnedEvidence.push(pinnedSource(document, metadata));
    }
    return {
      reference: entry.reference, title: entry.title,
      ...(entry.anonymized ? { synthetic: false, anonymized: true, pilotLockSha256: ledger.state.pilotLockSha256 } : { synthetic: true }),
      claimRecordId: docRole('claim'), d1RecordIds: [docRole('d1')],
      evidenceIds: [docRole('claim'), docRole('d1')], claimText: entry.claim.quote, noticeText: entry.notice.quote,
      instructionsText: entry.instructions, documents, pinnedEvidence,
      context: { jurisdiction: 'VN', asOf: entry.asOf, claimVersion: 'PDF trang ' + entry.claim.page + ' · ' + entry.claim.label.slice(0, 80) },
      sections: { matrix: { rows: [], approval: null }, response: { text: '', evidenceIds: [], approval: null } }
    };
  }, matter => ({ toolCallId: tool.toolCallId,
    evidence: matter.documents.map(({ role, sha256, page, start, end, textSha256 }) => ({ role, sha256, page, start, end, textSha256 })) }));
}

async function directDraft(ledger, connection, out, entry, phase, matter, task, fetcher) {
  const path = join(out, 'direct-workspace', `${entry.id}-draft-${phase}.json`);
  if (existsSync(path)) return cachedProviderOutput(ledger, entry, phase, 'generate', path);
  const targets = phase === 1 ? ['matrix', 'response'] : ['response'];
  const payload = buildPatentPrompt({ matter, targets, instruction: task }, connection);
  const options = JSON.parse(payload.messages[1].content).spanOptions;
  return providerCall(ledger, connection, entry, phase, 'generate', payload, choice => {
    assert.equal(choice?.finish_reason, 'stop', 'Incomplete model proposal');
    const raw = JSON.parse(choice.message.content);
    assert.deepEqual(Object.keys(raw).sort(), [...targets].sort(), 'Unexpected proposal sections');
    // The arms share exact span resolution and the output shape. Direct prose
    // is kept as generated, so no app D1 rewriting or semantic gate is used.
    const result = materializePatentSpans(raw, options);
    if (result.matrix) {
      result.matrix.rows = result.matrix.rows.map(row => ({ feature: row.feature, claimQuote: row.claimQuote,
        claimQuoteRecordId: row.claimSpan.recordId, d1RecordId: row.d1RecordId, d1Quote: row.d1Quote,
        assessment: row.assessment, analysis: row.analysis, missing: row.missing }));
      for (const row of result.matrix.rows) assert.ok([row.feature, row.analysis, row.missing].every(value => typeof value === 'string'));
      result.matrix.approval = null;
    }
    assert.ok(typeof result.response.text === 'string' && result.response.text.trim());
    assert.ok(Array.isArray(result.response.evidenceIds) && result.response.evidenceIds.every(id => typeof id === 'string'));
    result.response.approval = null;
    return result;
  }, path, fetcher);
}

async function executePhase(ledger, connection, out, entry, phase) {
  const record = ledger.state.cases[entry.id];
  if (record.phases[phase]?.wordSha256) return;
  if (phase === 2 && !record.phases[1]?.wordSha256) throw new Error('Phase 1 did not produce a saved baseline');
  const started = performance.now();
  const task = phase === 1 ? entry.phase1Task : entry.phase2Task;
  track(ledger, 'operator', entry.id, phase, phase === 1 ? 'supply case folder and instructions' : 'supply saved case folder and updated instructions');
  track(ledger, 'operator', entry.id, phase, 'send drafting task');
  const tool = await selectReadTool(ledger, connection, out, entry, phase, task);
  const matter = await executeReadTool(ledger, out, entry, phase, tool);
  const draft = await directDraft(ledger, connection, out, entry, phase, matter, task);
  matter.sections = { ...matter.sections, ...draft };
  const matrixHash = sha(JSON.stringify(matter.sections.matrix.rows));
  if (phase === 2) assert.equal(matrixHash, record.phases[1].matrixSha256);
  const quality = qualityView(matter, entry, phase);
  const approvedAt = new Date(`${entry.asOf}T00:00:00Z`).toISOString();
  const approval = { by: { name: 'nghiem-thu', role: 'reviewer' }, at: approvedAt, reviewedEvidence: true };
  if (phase === 1) {
    track(ledger, 'operator', entry.id, phase, 'review matrix evidence');
    track(ledger, 'operator', entry.id, phase, 'approve matrix');
    matter.sections.matrix.approval = approval;
  }
  track(ledger, 'operator', entry.id, phase, 'review response evidence');
  track(ledger, 'operator', entry.id, phase, 'approve response');
  matter.sections.response.approval = approval;
  const wordSha256 = await measure(ledger, 'tool', entry.id, phase, 'save local workspace and render versioned Word', async () => {
    const release = { ...matter, number: phase, at: approvedAt, createdAt: approvedAt,
      template: patentWordRendererV2, privateEvidence: privateEvidence(matter), approvedBy: approval.by };
    const bytes = makePatentWordV2(release);
    const digest = sha(bytes);
    const path = wordPath(out, entry, phase);
    if (existsSync(path)) assert.equal(sha(readFileSync(path)), digest, 'Saved Word changed');
    else writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
    writeJSON(casePath(out, entry, phase), matter);
    return digest;
  });
  track(ledger, 'operator', entry.id, phase, 'retrieve versioned Word');
  if (phase === 2) {
    assert.notEqual(wordSha256, record.phases[1].wordSha256);
    const originalDigest = sha(readFileSync(wordPath(out, entry, 1)));
    assert.equal(originalDigest, record.phases[1].wordSha256);
    quality.matrixPreserved = true;
    quality.word1Preserved = true;
  }
  record.phases[phase] = { quality, wordSha256, matrixSha256: matrixHash, elapsedMs: Math.round(performance.now() - started) };
  ledger.save();
  console.log(`Direct agent ${entry.id} phase ${phase} complete`);
}

function checkProviderCooldown(ledger) {
  if (process.env.DAITIN_PILOT_RETRY_429 === '1') {
    const latest = ledger.state.modelAttempts.findLast(item => item.providerStatus === 429);
    assert.ok(latest, 'Manual 429 recovery requires a recorded provider rate limit');
    const at = Date.parse(latest.attemptedAt);
    const raw = latest.retryAfter ?? '';
    const retryAfter = /^\d+$/.test(raw) ? at + Number(raw) * 1000 : Date.parse(raw);
    const readyAt = Math.max(at + 75000, Number.isFinite(retryAfter) ? retryAfter : at);
    assert.ok(Date.now() >= readyAt, 'Wait for the provider cooldown before manually resuming');
  }
}

export async function runDirect({ out, input }) {
  const connection = modelConnection();
  assert.ok(connection && connection.model === modelId && connection.provider === 'ai-gateway.vercel.sh', 'Reuse the same Vercel AI Gateway Gemini model');
  const ledger = openLedger(out, 'direct', input.manifestSha256, input.cases);
  checkProviderCooldown(ledger);
  ledger.state.modelProvider = connection.provider;
  directory(join(out, 'direct-workspace'));
  directory(join(out, 'direct-word'));
  let stoppedOnRateLimit = false;
  for (const phase of [1, 2]) {
    const pending = input.cases.filter(entry => !ledger.state.cases[entry.id].phases[phase]?.wordSha256);
    if (!pending.length) continue;
    const started = performance.now();
    track(ledger, 'operator', null, phase, 'begin fresh direct session');
    for (const entry of pending) {
      try { await executePhase(ledger, connection, out, entry, phase); }
      catch (error) {
        const record = ledger.state.cases[entry.id];
        record.errors ??= {};
        record.errors[phase] = error.message;
        ledger.save();
        console.error(`Direct agent ${entry.id} phase ${phase}: ${error.message}`);
        if (error instanceof RateLimitPause) {
          stoppedOnRateLimit = true;
          break;
        }
      }
    }
    track(ledger, 'operator', null, phase, 'end direct session');
    ledger.state.sessionRuns ??= [];
    ledger.state.sessionRuns.push({ phase, elapsedMs: Math.round(performance.now() - started), finishedAt: timestamp() });
    ledger.save();
    if (stoppedOnRateLimit) break;
  }
  ledger.state.stoppedOnRateLimit = stoppedOnRateLimit;
  ledger.state.finishedAt = timestamp();
  ledger.save();
}

export function verifyHumanPhase(out, entry, phase, record, lock, pilotLockSha256) {
  try {
    const matter = readJSON(casePath(out, entry, phase));
    assert.equal(record.pilotLockSha256, pilotLockSha256);
    assert.equal(matter.pilotLockSha256, pilotLockSha256);
    assert.equal(matter.reference, lock.reference);
    assert.equal(matter.context.asOf, lock.asOf);
    verifyLockedDocuments(matter.documents, lock);
    verifyLockedDocuments(record.documents, lock);
    assert.equal(matter.claimText, entry.claim.quote);
    assert.equal(matter.noticeText, entry.notice.quote);
    assert.equal(matter.instructionsText, phase === 1 ? entry.instructions : entry.phase2Instructions);
    assert.equal(matter.claimRecordId, docRole('claim'));
    assert.deepEqual(matter.d1RecordIds, [docRole('d1')]);
    assert.deepEqual(matter.evidenceIds, [docRole('claim'), docRole('d1')]);
    assert.equal(matter.pinnedEvidence.length, 2);
    for (const role of ['claim', 'd1']) {
      const pinned = matter.pinnedEvidence.find(item => item.record.id === docRole(role));
      assert.equal(pinned?.record.text, entry[role].quote);
      assert.equal(pinned.record.locator.page, lock.sources[role].page);
      assert.equal(pinned.source.sha256, lock.sources[role].sha256);
    }
    assert.equal(sha(readFileSync(wordPath(out, entry, phase))), record.wordSha256);
    assert.equal(sha(JSON.stringify(matter)), record.caseSha256);
    assert.equal(sha(JSON.stringify(matter.sections.matrix.rows)), record.matrixSha256);
    assert.deepEqual(matter.sections.matrix.approval, record.approvals.matrix);
    assert.deepEqual(matter.sections.response.approval, record.approvals.response);
    return matter;
  } catch {
    throw new HumanPilotError('Dấu kiểm hồ sơ hoặc Word đã duyệt bị thay đổi.');
  }
}

function publishWord(path, bytes) {
  if (!existsSync(path)) {
    const staging = path + '.next';
    try {
      writeFileSync(staging, bytes, { mode: 0o600 });
      linkSync(staging, path);
    } finally { rmSync(staging, { force: true }); }
  }
  if (sha(readFileSync(path)) !== sha(bytes)) throw new HumanPilotError('Bản Word đã tồn tại có dấu kiểm khác.');
}

async function executeHumanPhase({ ledger, connection, out, entry, phase, ask, show, fetcher, lock, documents }) {
  const record = ledger.state.cases[entry.id];
  const { pilotLockSha256 } = ledger.state;
  let baseline;
  if (phase === 2) {
    if (!record.phases[1]?.wordSha256) throw new HumanPilotError('Hoàn tất duyệt và xuất Word phiên 1 trước.');
    baseline = verifyHumanPhase(out, entry, 1, record.phases[1], lock, pilotLockSha256);
  }
  for (const { metadata } of documents) {
    const path = savedPDF(out, entry, metadata.role);
    if (!existsSync(path) && phase === 1 && !record.phases[1]?.wordSha256) continue;
    if (!existsSync(path) || sha(readFileSync(path)) !== metadata.sha256) {
      throw new HumanPilotError('PDF đã lưu không khớp bản khóa ở ' + entry.id + '/' + metadata.role + '.');
    }
  }
  if (record.phases[phase]?.wordSha256) {
    verifyHumanPhase(out, entry, phase, record.phases[phase], lock, pilotLockSha256);
    show('Đã có Word được xác nhận: ' + wordPath(out, entry, phase));
    return;
  }
  const task = phase === 1 ? entry.phase1Task : entry.phase2Task;
  show('Hồ sơ ' + entry.id + ', phiên ' + phase + '. Đọc nhiệm vụ trên phiếu của điều phối viên.');
  const start = await ask('Anh Bình mở hồ sơ và giao yêu cầu đã khóa cho agent? [y/N] ');
  if (start.trim().toLowerCase() !== 'y') throw new HumanPilotError('Phiên đang chờ anh Bình bắt đầu.');
  track(ledger, 'operator', entry.id, phase, 'human opens direct session', { at: timestamp() });
  const tool = await selectReadTool(ledger, connection, out, entry, phase, task, fetcher);
  const matter = await executeReadTool(ledger, out, entry, phase, tool, documents, baseline);
  const draft = await directDraft(ledger, connection, out, entry, phase, matter, task, fetcher);
  const approved = await approveDirectDraft({ ledger, out, entry, phase, matter, draft, ask, show });
  matter.sections = { ...matter.sections, ...approved };
  const matrixSha256 = sha(JSON.stringify(matter.sections.matrix.rows));
  const quality = qualityView(matter, entry, phase);
  if (phase === 2) {
    verifyHumanPhase(out, entry, 1, record.phases[1], lock, pilotLockSha256);
    if (record.phases[1].matrixSha256 !== matrixSha256 ||
      record.phases[1].approvals.matrix.sha256 !== matter.sections.matrix.approval?.sha256) {
      throw new HumanPilotError('Ma trận đã duyệt ở phiên 1 bị thay đổi.');
    }
    quality.matrixPreserved = true;
    quality.word1Preserved = true;
  }
  const approvedAt = matter.sections.response.approval.at;
  const release = { ...matter, number: phase, at: approvedAt, createdAt: approvedAt,
    template: patentWordRendererV2, privateEvidence: privateEvidence(matter), approvedBy: matter.sections.response.approval.by };
  const path = wordPath(out, entry, phase);
  const wordSha256 = await measure(ledger, 'tool', entry.id, phase, 'render versioned Word after human approval', () => {
    const bytes = makePatentWordV2(release);
    publishWord(path, bytes);
    writeJSON(casePath(out, entry, phase), matter);
    return sha(bytes);
  });
  if (phase === 2 && wordSha256 === record.phases[1].wordSha256) {
    throw new HumanPilotError('Word phiên 2 trùng bản cũ. Giữ nguyên thư mục để kiểm tra.');
  }
  record.phases[phase] = { quality, wordSha256, matrixSha256, pilotLockSha256, caseSha256: sha(JSON.stringify(matter)),
    approvals: Object.fromEntries(Object.entries(matter.sections).map(([key, value]) => [key, value.approval])),
    documents: matter.documents.map(({ role, page, start, end, sha256, textSha256 }) => ({ role, page, start, end, sha256, textSha256 })) };
  ledger.state.humanReview = 'operator_attested';
  ledger.save();
  show('Đã lưu Word. Mở đúng tệp này để hoàn tất phiên: ' + path);
}

export async function runHumanDirect({ out, input, phase, sourceLock, ask, show = console.log,
  connection = modelConnection(), fetcher = fetch }) {
  if (![1, 2].includes(phase) || input.cases.some(entry => entry.synthetic !== false || entry.anonymized !== true) ||
    !connection || connection.model !== modelId || connection.provider !== 'ai-gateway.vercel.sh' ||
    connection.endpoint !== 'https://ai-gateway.vercel.sh/v1/chat/completions') {
    throw new HumanPilotError('Cấu hình phiên, loại hồ sơ hoặc Gemini trên Vercel AI Gateway chưa khớp.');
  }
  let approved;
  try { approved = parsePilotLock(sourceLock); }
  catch { throw new HumanPilotError('Cần bản khóa nguồn đã duyệt độc lập trước khi gọi model.'); }
  const { lock, documents } = await deriveHumanSourceLock(input, approved);
  const pilotLockSha256 = pilotLockDigest(lock);
  const ledger = openLedger(out, 'direct', input.manifestSha256, input.cases, { human: true, pilotLockSha256 });
  checkProviderCooldown(ledger);
  ledger.state.modelProvider = connection.provider;
  directory(join(out, 'direct-workspace'));
  directory(join(out, 'direct-word'));
  try {
    const [entry] = input.cases;
    await executeHumanPhase({ ledger, connection, out, entry, phase, ask, show, fetcher, lock, documents });
    ledger.state.finishedAt = timestamp();
    ledger.save();
  } catch (error) {
    if (error instanceof HumanPilotError) throw error;
    if (error instanceof RateLimitPause) throw new HumanPilotError('Gateway trả 429. Kiểm biên nhận, chờ ít nhất 75 giây và tiếp tục đúng phiên.');
    throw new HumanPilotError('Phiên chưa hoàn tất. Xem biên nhận cục bộ và giữ nguyên thư mục; lượt chưa rõ kết quả không được tự gửi lại.');
  }
}
