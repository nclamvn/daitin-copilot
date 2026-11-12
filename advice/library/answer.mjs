import { labels } from './retrieval.mjs';

const simulated = '[MÔ PHỎNG — CHỈ DÙNG DIỄN TẬP]\n\n';
const requiresDetails = row => ['expired', 'confirm-calendar', 'verify-office-record'].includes(row.value);
const citation = (row, state) => ({
  id: row.id, title: row.title, quote: row.quote, kind: row.kind, date: row.date, simulated: row.simulated, state,
  anchor: (row.simulated ? row.file : row.title) + ' · Đoạn ' + row.paragraph,
  fingerprint: row.quoteSha256, origin: row.origin, locator: row.locator, download: '/api/advice/source/' + row.id,
});
const unique = items => [...new Set(items)];
const titles = {
  supported: 'Có hướng dẫn trong kho',
  conflict: 'Cần xác nhận hai hướng dẫn mâu thuẫn',
  missing: 'Chưa đủ căn cứ để trả lời',
};

export async function libraryAnswer(index, question, scenario, model, { measure = false, simulation = true } = {}) {
  const { scope, active, context, replaced, supplemental } = index.retrieve(question, scenario);
  const values = unique(active.map(row => simulation ? row.value : row.value + ':' + row.statement));
  const normalized = question.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd');
  const signing = /\b(cong chung|chung thuc|apostille|notari[sz]\w*|legalization|ban goc|ban scan)\b/.test(normalized);
  const reuse = /\b(dung lai|su dung lai|reuse|tai su dung|poa cu)\b/.test(normalized);
  const directly = /\b(tu nop|nop truc tiep|khong qua dai dien|without an agent|directly)\b/.test(normalized);
  const viaAgentOnly = active.length > 0 && active.every(row => {
    if (row.value === 'agent-required' || row.value === 'agent-signed') return true;
    const quote = (row.statement ?? row.quote).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd');
    return /\b(qua (hang )?dai dien|khi hang|do hang nop|cung hang dai dien)\b/.test(quote);
  });
  const poaDetail = scope?.[3] === 'poa' && (
    (signing && !active.some(row => row.value === 'notary')) ||
    (reuse && !active.some(row => ['reuse-valid', 'reuse', 'new'].includes(row.value))) ||
    (directly && viaAgentOnly)
  );
  const details = poaDetail || active.some(requiresDetails);
  const kind = values.length > 1 ? 'conflict' : !values.length || details ? 'missing' : 'supported';
  const displayed = active.slice(0, 6);
  const attachments = kind === 'supported' && (simulation || unique(supplemental.map(row => row.statement)).length <= 1)
    ? supplemental : [];
  const candidates = [...displayed, ...attachments, ...context, ...replaced.slice(0, 3)].slice(0, 10);
  let run;
  let modelFailed = false;
  let modelError;
  if (model && (candidates.length || measure)) {
    try {
      run = await model(question, candidates);
    } catch (error) {
      modelFailed = true;
      if (measure) modelError = error.message;
    }
  }
  const scoped = scope ? scope.map((key, i) => labels[i][key]) : null;
  const field = poaDetail && signing ? 'yêu cầu về hình thức của POA'
    : poaDetail && reuse ? 'khả năng dùng lại POA'
      : poaDetail && directly ? 'yêu cầu POA khi chủ thể tự nộp' : scoped?.[3];
  const name = scoped ? scoped[2] + ' ' + scoped[1] + ' tại ' + scoped[0] : '';
  const citations = [
    ...displayed.map(row => citation(row, kind === 'missing' ? 'context' : 'active')),
    ...attachments.map(row => citation(row, 'active')),
    ...context.map(row => citation(row, 'context')),
    ...replaced.slice(0, 3).map(row => citation(row, 'superseded')),
  ];
  const preferred = kind === 'supported' && run?.status === kind
    ? unique(run.ids).map(id => displayed.find(row => row.id === id)).filter(Boolean) : [];
  const picked = kind === 'supported' ? (preferred.length ? preferred : active.slice(0, 2)) : [];
  const used = [...picked, ...attachments];
  const indexed = unique(used.map(row => simulation ? row.quote : row.statement));
  const notes = [];
  if (kind === 'supported' && used.some(row => !row.date)) notes.push('Nguồn chưa ghi ngày xác nhận.');
  if (kind === 'supported' && replaced.length) notes.push('Có hướng dẫn thay thế rõ ràng. Đoạn trước vẫn mở được trong căn cứ.');
  if (poaDetail && active.length) notes.push('Các đoạn hiện có chưa xác nhận chi tiết về POA được hỏi.');
  if (details) notes.push(...unique(active.filter(requiresDetails).map(row => row.quote)).slice(0, 2));
  if (modelFailed) notes.push('Đã hiển thị kết quả đối chiếu nguồn. Model tạm thời chưa phản hồi.');
  const poaTitles = {
    signed: 'Cần POA đã ký theo nguồn',
    'signed-owner': 'Cần giấy ủy quyền do chủ sở hữu ký',
    'reuse-valid': 'Có thể dùng lại POA nếu đáp ứng điều kiện',
    'agent-required': 'Cần văn bản ủy quyền khi nộp qua đại diện',
    'agent-signed': 'Hãng đại diện cần POA đã ký',
    notary: 'Đối tác yêu cầu POA có công chứng',
  };
  const supportedTitle = scope?.[3] === 'documents' ? 'Tài liệu cần chuẩn bị' : poaTitles[picked[0]?.value];
  const title = !scoped ? 'Cần làm rõ phạm vi câu hỏi' : kind === 'supported' && supportedTitle ? supportedTitle : titles[kind];
  const body = !scoped ? 'Cho biết một quốc gia, loại quyền, thủ tục và nội dung cần hỏi.'
    : kind === 'conflict' ? 'Các nguồn đưa ra hướng dẫn khác nhau cho cùng thủ tục. Cần đối tác xác nhận hướng dẫn đang áp dụng.'
      : kind === 'missing' ? 'Kho chưa đủ căn cứ để xác nhận ' + field + ' cho việc ' + name + '.'
        : indexed.join('\n\n');
  const clientReady = simulation || used.every(row => row.clientText);
  if (kind === 'supported' && !clientReady) notes.push('Đoạn này chưa có nội dung đã duyệt để sao chép vào thư khách.');
  const prefix = simulation ? simulated : '';
  const privateDraft = unique(used.map(row => row.clientText)).join('\n\n');
  const email = !scoped || (kind === 'supported' && !clientReady) ? '' : kind === 'supported'
    ? prefix + 'Chào anh/chị,\n\n' +
      (simulation ? 'Theo hướng dẫn nghiệp vụ hiện có về ' + name + ', ' + body.charAt(0).toLowerCase() + body.slice(1)
        : privateDraft) +
      (used.some(row => !row.date) ? '\n\nYêu cầu áp dụng tại thời điểm thực hiện cần được xác nhận.' : '') +
      '\n\nTrân trọng,'
    : prefix + 'Chào anh/chị,\n\nNhờ anh/chị xác nhận ' + field + ' đang áp dụng cho việc ' + name + '. ' +
      (kind === 'conflict' ? 'Các hướng dẫn hiện có khác nhau. Xin cho biết hướng dẫn nào thay thế bản trước và áp dụng từ ngày nào. '
        : 'Xin cho biết điều kiện áp dụng và nguồn có thể đối chiếu. ') + '\n\nCảm ơn anh/chị.';
  return { kind, simulation, scope: name, title, body, notes, citations, email,
    emailKind: kind === 'supported' ? 'reply' : 'verification',
    ...(measure ? { run: run ?? null, modelFailed, modelError, candidateIds: candidates.map(row => row.id) } : {}),
  };
}
