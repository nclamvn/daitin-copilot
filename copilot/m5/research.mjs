import { digest } from '../../sot/bundle.mjs';
import { bounded, CaseError } from '../m3/workflow.mjs';

const fold = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd');
const scope = 'Nhãn hiệu theo thể thức quốc gia tại Việt Nam';
const madridGuide = 'https://www.wipo.int/en/web/madrid-system/find-and-monitor-international-trademark-registrations';
const topics = ['office_response', 'renewal'];
const conflict = /\b(?:khong phai nhan hieu|khong phai gia han|khong phai thong bao tham dinh|gia han (?:don|ho so dang ky)|chua (?:duoc )?cap van bang)\b/;
const pinSource = item => ({ ...item, snapshotUrl: item.snapshotUrl.replace(/\.pdf#page=/, '/' + item.sha256 + '.pdf#page=') });
const datePattern = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4})';
const quoteDates = (text, cue) => [...new Set([...text.matchAll(new RegExp('\\b(?:' + cue + ')\\s+' + datePattern + '\\b', 'g'))]
  .map(([, date]) => {
    const [day, month, year] = date.split('/');
    return year ? year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0') : date;
  }))];

function readDates(input, query) {
  const review = quoteDates(query, 'doi chieu(?: tai)?(?: ngay)?|kiem tra(?: tai)?(?: ngay)?');
  const planned = quoteDates(query, 'du kien nop(?: vao)?(?: ngay)?');
  const received = quoteDates(query, 'tiep nhan(?: vao)?(?: ngay)?');
  const uncertain = /\b(?:chua|khong|chua ro|khong ro) (?:duoc )?(?:tiep nhan|du kien nop|doi chieu)\b/.test(query);
  const asOf = input.asOf ?? review[0] ?? planned[0] ?? null;
  const receivedOn = input.receivedOn ?? received[0] ?? null;
  const mode = received.length ? 'case' : input.mode ?? 'prepare';
  const pendingAtCutover = input.pendingAtCutover ?? null;
  const conflicting = (uncertain && (review.length || planned.length || received.length)) ||
    [...review, ...planned].some(date => date !== asOf) || received.some(date => date !== receivedOn) ||
    (planned.length > 0 && mode === 'case') ||
    (mode === 'prepare' && (receivedOn !== null || pendingAtCutover !== null)) ||
    (input.mode !== undefined && !['prepare', 'case'].includes(input.mode));
  return { asOf, mode, receivedOn, pendingAtCutover, conflicting };
}

export function createResearch({ catalog, search, review, templates }) {
  return (input, actor) => {
    const question = bounded(input?.question, 300, 'Câu hỏi');
    if (input.anonymized !== true) throw new CaseError('Xác nhận câu hỏi mô phỏng hoặc đã ẩn danh và được phép.');
    const query = fold(question);
    const { conflicting, ...fields } = readDates(input, query);
    const { asOf, mode } = fields;
    const found = search(question, conflicting ? catalog.checkedThrough : asOf ?? catalog.checkedThrough);
    const common = { question, scope, coverage: { from: catalog.coveredFrom, through: catalog.checkedThrough },
      release: catalog.release, sot: catalog.releaseDigest, dataStatus: catalog.dataStatus };
    const result = (status, title, explanation, { citations = [], form = null, ...details } = {}) =>
      ({ ...common, status, title, explanation, missing: [], ...details,
        citations: citations.map(pinSource), form: form ? pinSource(form) : null });
    if (found.status === 'out_of_scope') {
      if (/\b(madrid|wipo)\b/.test(query)) {
        const designation = query.match(/\bchi dinh ([^.!?;,]+)/)?.[1] ?? '';
        const targets = [['VN', 'Việt Nam', /\b(?:viet nam|vn)\b/], ['TH', 'Thái Lan', /\b(?:thai lan|thailand)\b/]]
          .filter(([, , pattern]) => pattern.test(designation)).map(([code, label]) => ({ code, label, status: 'Chưa xác minh' }));
        return result('referral', 'Đối chiếu tình trạng theo từng chỉ định Madrid',
          'Mở hồ sơ đăng ký quốc tế theo số IR. Kiểm tra mục Designation status và ghi riêng tình trạng, nhóm và ngày của từng chỉ định. Kết quả tra cứu quốc gia trong bàn hồ sơ không xác nhận trạng thái Madrid.',
          { referral: { label: 'Tra cứu đăng ký quốc tế tại WIPO', url: madridGuide, targets } });
      }
      return result('referral', 'Ngoài phạm vi kho này', found.message);
    }
    const hits = found.hits.filter(hit => hit.status === 'applicable');
    if (conflicting) return result('needs_review', 'Dữ kiện thời điểm chưa thống nhất',
      'Kiểm tra ngày trong câu hỏi và ngày đã chọn. Xác nhận đúng vai trò của từng ngày trước khi chọn mẫu.');
    if (found.status === 'needs_review' || conflict.test(query) ||
        /\b(?:thong bao|phan hoi|yeu cau lam ro|nop don moi|dang ky moi|sua van bang|thay doi chu so huu)\b/.test(query) &&
          /\bgia han\b/.test(query)) {
      return result('needs_review', 'Cần rà soát riêng trước khi kết luận',
        'Kiểm tra thủ tục và dữ kiện trong hồ sơ. Căn cứ liên quan dưới đây chỉ để đọc thêm.', { citations: hits });
    }
    const explicitLocator = /\b(?:dieu|muc)\s+\d+\b/.test(query);
    const asksProcedure = /\b(?:mau|bieu mau|thu tuc|phan hoi|nop|dung gi|lam gi|can gi|can cu)\b/.test(query);
    const fallbackTopic = /\b(?:cong van tra loi|tra loi thong bao|phan hoi ket qua tham dinh|giai trinh thong bao)\b/.test(query)
      ? 'office_response' : /\b(?:keo dai hieu luc|tiep tuc hieu luc)\b/.test(query) ? 'renewal' : null;
    const procedure = found.procedure ?? fallbackTopic;
    if (!explicitLocator && topics.includes(procedure) && asksProcedure) {
      if (!asOf) return result('needs_context', 'Cần ngày đối chiếu', 'Chọn mốc cần kiểm tra trước khi xác định căn cứ và phiên bản mẫu.',
        { missing: ['asOf'], procedure, fields });
      if (procedure === 'office_response' && mode !== 'case') {
        return result('needs_context', 'Cần ngày tiếp nhận của hồ sơ đang xử lý',
          'Văn bản phản hồi gắn với một đơn đang xử lý. Xác nhận ngày cơ quan tiếp nhận đơn.', {
            missing: ['receivedOn'], procedure, fields: { ...fields, mode: 'case' }
          });
      }
      const proof = review({ ...fields, procedure });
      const { resolution } = proof;
      const answer = result(resolution.status, resolution.title, resolution.explanation, {
        procedure, fields, applicableOn: resolution.applicableOn, checkedOn: asOf, citations: resolution.citations,
        form: resolution.form, missing: resolution.missing, rule: resolution.rule,
        corpus: proof.corpusDigest
      });
      if (resolution.status === 'grounded' && procedure === 'office_response') {
        answer.template = templates.current(actor.group);
        answer.proofId = digest(answer);
      }
      return answer;
    }
    if (explicitLocator && found.hits.length === 1) {
      const hit = found.hits[0];
      return result(hit.status === 'applicable' ? 'reference' : 'needs_review', hit.locator,
        hit.status === 'applicable' ? hit.summary : 'Điều khoản được tìm thấy. Cần kiểm tra phiên bản áp dụng tại mốc đã chọn.',
        { checkedOn: found.on, citations: [hit] });
    }
    if (found.hits.length) return result('references', 'Các căn cứ tìm thấy',
      'Mở đúng trang để đối chiếu. Chọn một điều khoản cụ thể hoặc nêu thủ tục và ngày cần kiểm để xác định cách áp dụng.',
      { checkedOn: found.on, citations: found.hits });
    return result('not_found', 'Chưa đủ căn cứ để trả lời', found.message);
  };
}
