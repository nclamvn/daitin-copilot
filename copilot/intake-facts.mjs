// Deterministic bindings for facts that the workbench is allowed to use.
import { uncertainFact } from './intake.mjs';
const fold = value => value.normalize('NFD').toLowerCase().replace(/\p{M}/gu,'').replace(/đ/g,'d');
const monthNames='january february march april may june july august september october november december'.split(' ');
const monthPattern=monthNames.map(m=>m.length>3?m.slice(0,3)+'(?:'+m.slice(3)+')?':m).join('|');
const tokenPattern=new RegExp('\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{2}/\\d{2}/\\d{4}|'+
  '\\d{1,2} (?:'+monthPattern+') \\d{4}|(?:'+monthPattern+') \\d{1,2},? \\d{4})\\b','gi');
const locale=/\b(Viet Nam|Vietnam(?:ese)?|Việt Nam|VN)\b/i;
const roles=[
  ['pending',/\b(?:still pending|pending|ongoing|still open|con dang giai quyet|chua giai quyet|dang giai quyet)\b/g],
  ['closed',/\b(?:closed|completed|resolved|da giai quyet|da hoan tat)\b/g],
  ['receipt',/\b(?:received|receipt|accepted|tiep nhan)\b/g],
  ['review',/\b(?:review as of|as of|review on|review date|assess|doi chieu|kiem tra)\b/g],
  ['planned',/\b(?:planned filing on|planned filing date|filing date|file on|submit on|file|submit|submission date|du kien nop|ngay nop|nop)\b/g]
];
const pad=n=>String(n).padStart(2,'0');

function normalizeDate(token,vi) {
  let y,m,d;
  if (token.includes('-')) [y,m,d]=token.split('-');
  else if (token.includes('/')) {
    [d,m,y]=token.split('/');
    if (!vi && Number(d)<=12) return null;
  } else {
    const fields=token.toLowerCase().replace(',','').split(' ');
    y=fields[2];
    const dayFirst=/^\d/.test(fields[0]);
    d=pad(dayFirst?fields[0]:fields[1]);
    m=pad(monthNames.findIndex(name=>name.startsWith(fields[dayFirst?1:0]))+1);
  }
  const value=[y,m,d].join('-');
  const time=new Date(value+'T00:00:00Z');
  return Number.isFinite(time.valueOf()) && time.toISOString().slice(0,10)===value ? value : null;
}

function binding(prefix) {
  const scan=fold(prefix);
  let best=null;
  for (const [role,pattern] of roles) {
    for (const match of scan.matchAll(pattern)) {
      if (!best || match.index>best.index) best={role,index:match.index};
    }
  }
  return best;
}

export function bindIntakeFacts(request) {
  const dates={planned:[],receipt:[],review:[],pending:[],closed:[]};
  const vietnamese=/\b(ngay|du kien|don nhan hieu|van bang|doi chieu)\b/.test(fold(request));
  for (const match of request.matchAll(tokenPattern)) {
    const index=match.index;
    const before=request.slice(Math.max(0,index-105),index);
    const prefix=before.split(/[.!?;\n]/).at(-1);
    const role=binding(prefix);
    const value=normalizeDate(match[0],vietnamese);
    if (!role || !value || uncertainFact.test(fold(prefix))) continue;
    const quote=prefix.slice(role.index)+match[0];
    dates[role.role].push({value,quote});
  }
  const one=role=>{
    const values=dates[role];
    return new Set(values.map(row=>row.value)).size===1 ? values[0] : null;
  };
  const onCutover=role=>dates[role].find(row=>row.value==='2026-07-01' && /2026-07-01|01\/07\/2026/.test(row.quote));
  const pending=onCutover('pending');
  const closed=onCutover('closed');
  const status=pending&&!closed?{value:true,quote:pending.quote}:closed&&!pending?{value:false,quote:closed.quote}:null;
  const words=fold(request);
  const ambiguousAmendment=/\b(?:unclear|not know|not sure|khong ro|chua ro|chua biet|chua xac dinh)\b/.test(words) &&
    /\b(?:application|don dang ky|sua don|don dang xet)\b/.test(words) &&
    /\b(?:certificate|van bang)\b/.test(words) && /\b(?:or|hay|hoac)\b/.test(words);
  return {
    jurisdiction:request.match(locale)?.[0]??null,
    planned:one('planned'),receivedOn:one('receipt'),reviewOn:one('review'),status,
    receiptMention:/\b(received on|date of receipt|tiep nhan ngay|da tiep nhan)\b/.test(words),
    ambiguousAmendment,
    conflict:Object.values(dates).some(rows=>new Set(rows.map(row=>row.value)).size>1)||Boolean(pending&&closed)
  };
}

const crossesCutover = bound => bound.receivedOn && bound.reviewOn &&
  bound.receivedOn.value<'2026-07-01' && bound.reviewOn.value>='2026-07-01';

export function intakeQuestion(reason, bound) {
  if (reason==='missing_workflow' && bound.ambiguousAmendment) {
    return 'Cần sửa thông tin trên đơn đang xét hay trên văn bằng đã cấp?';
  }
  if (reason==='missing_date' && !bound.receivedOn && !bound.receiptMention) {
    return 'Ngày dự kiến nộp yêu cầu là ngày nào?';
  }
  return {
    missing_jurisdiction:'Hồ sơ thuộc nước nào và theo tuyến quốc gia hay quốc tế?',
    missing_workflow:'Hồ sơ đang cần thực hiện thủ tục nào?',
    missing_date:'Ngày tiếp nhận và ngày đối chiếu của hồ sơ là ngày nào?',
    missing_pending:'Tại ngày 01/07/2026, hồ sơ còn đang giải quyết hay đã giải quyết?',
    conflict:'Dữ kiện nào là chính xác khi đối chiếu với hồ sơ gốc?',
    insufficient_evidence:'Dữ kiện nào có thể xác nhận từ hồ sơ gốc để tiếp tục?'
  }[reason]??null;
}

export function buildBoundPlan(request,proposal,bound) {
  const evidence=[request.trim().slice(0,180)];
  const plan={...proposal,version:'dai-tin-intake-1',evidence,facts:{},tools:[]};
  const finish=(decision,reason)=>({...plan,decision,reason});
  if (proposal.decision==='refer') return plan;
  if (bound.conflict) return finish('refer','conflict');
  if (!bound.jurisdiction) return finish('clarify','missing_jurisdiction');
  if (proposal.decision==='clarify') {
    if (bound.ambiguousAmendment) return finish('clarify','missing_workflow');
    if (proposal.reason==='missing_pending' && (!crossesCutover(bound)||bound.status)) {
      const isCase=Boolean(bound.receivedOn||bound.receiptMention);
      const dateMissing=isCase ? !bound.receivedOn||!bound.reviewOn : !bound.planned;
      return finish('clarify',dateMissing?'missing_date':'insufficient_evidence');
    }
    return plan;
  }
  if (proposal.decision==='prepare' && bound.ambiguousAmendment) return finish('clarify','missing_workflow');
  plan.facts.jurisdiction=bound.jurisdiction;
  if (proposal.decision==='prepare') {
    const isCase=Boolean(bound.receivedOn||bound.receiptMention);
    if (!proposal.workflow) return finish('clarify','missing_workflow');
    if (isCase) {
      if (!bound.receivedOn||!bound.reviewOn) return finish('clarify','missing_date');
      plan.facts.mode='case';
      plan.facts.receivedOn=bound.receivedOn;
      plan.facts.asOf=bound.reviewOn;
      if (crossesCutover(bound)) {
        if (!bound.status) return finish('clarify','missing_pending');
        plan.facts.pendingAtCutover=bound.status;
      }
    } else {
      if (!bound.planned) return finish('clarify','missing_date');
      plan.facts.mode='prepare';
      plan.facts.asOf=bound.planned;
    }
  }
  plan.tools=proposal.tools.map(item=>{
    const q=item.input.trim();
    const start=request.toLowerCase().indexOf(q.toLowerCase());
    const input=start>=0?request.slice(start,start+q.length):q;
    return {kind:item.kind,input,quote:input};
  });
  return plan;
}
