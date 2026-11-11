import base64
import json
import sys
from pathlib import Path

app = Path(__file__).resolve().parent.parent
demo = Path(sys.argv[1])
target = Path(sys.argv[2])
seed = json.loads((demo / 'seed.json').read_text())
states = json.loads((demo / 'preview-states.json').read_text())
files = {name: base64.b64encode(path.read_bytes()).decode() for path in demo.iterdir()
         if path.suffix in ('.docx', '.pdf') for name in [path.name]}
payload = json.dumps({'seed': seed, 'states': states, 'files': files}, ensure_ascii=False).replace('</', r'<\/')
logo = 'data:image/png;base64,' + base64.b64encode((app / 'public/brand/daitin.png').read_bytes()).decode()
fonts = (app / 'public/fonts.css').read_text()
page = r"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DAITIN Copilot | Bản xem trước MVP</title><link rel="icon" href="__LOGO__"><style>
__FONTS__
:root{--ink:#182b2e;--muted:#526664;--green:#174d42;--line:#d7e0dc;--paper:#fff}
*{box-sizing:border-box}body{margin:0;font:13px/1.55 "Be Vietnam Pro",system-ui,sans-serif;color:var(--ink);background:#f0f3f1}
button,a{font:inherit}button{cursor:pointer}a{color:var(--green);text-underline-offset:3px}button:disabled{opacity:.45;cursor:default}
h1,h2,h3,p{margin:0}.banner{min-height:42px;padding:9px 20px;background:#e2eee8;border-bottom:1px solid #c5d9cf;display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:11px}
.banner span{color:#3d5c51}.shell{display:grid;grid-template-columns:216px minmax(0,1fr);min-height:calc(100dvh - 42px)}
.sidebar{background:#101f26;color:#e5efea;padding:23px 14px;display:flex;flex-direction:column;gap:15px}
.logo{width:100%;height:auto;background:#fff;padding:9px;border-radius:5px;display:block}.brand-note{font-size:10px;color:#b9d0ce;margin-top:8px}
.sidebar h2{font-size:11px;color:#b9d0ce;font-weight:500;margin-top:8px}.matter{display:block;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:inherit;padding:10px 9px;border-radius:5px;margin-top:5px}
.matter[aria-current=true]{background:#243e3d;border-color:#446359}.matter strong{display:block;font-size:12px}.matter small{font-size:10px;color:#b9d0ce}
.side-note{font-size:10px;color:#b9d0ce;margin-top:auto;padding-top:25px}
.body{min-width:0}.topbar{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:13px 23px;background:#fafcfb;border-bottom:1px solid var(--line);font-size:11px}
.topbar b{font-weight:600}.layout{display:grid;grid-template-columns:minmax(0,1fr) 290px;min-height:calc(100dvh - 94px)}
main{padding:24px clamp(16px,3vw,38px);min-width:0}.context{font-size:11px;color:var(--muted)}h1{font-size:32px;letter-spacing:-.04em;margin:5px 0 8px;line-height:1.2}
.meta{color:var(--muted);font-size:11px;display:flex;gap:12px;flex-wrap:wrap}.tour{margin:20px 0 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
button,.download{border:1px solid #bdcfc4;background:white;color:#234d43;border-radius:5px;padding:7px 10px;font-size:11px;font-weight:600}
.tour button[aria-pressed=true]{background:#174d42;color:#fff;border-color:#174d42}.paper{background:white;border:1px solid #ccd9d2;border-radius:9px;padding:20px;box-shadow:0 2px 5px #21332908}
.paper h2{font-size:16px;line-height:1.4;letter-spacing:-.02em}.paper>p{font-size:11px;color:var(--muted);margin:5px 0 13px}
.section{border-top:1px solid #e0e8e2;padding:13px 0}.section-head{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px}
.section h3{font-size:13px}.badge{font-size:10px;color:#285347;background:#e5f0eb;padding:2px 6px;border-radius:4px;white-space:nowrap}.pending{background:#f7edd8;color:#744b17}
.section p{font-size:13px;line-height:1.7;max-width:72ch;white-space:pre-wrap}.old{color:#7c483e;background:#f6ebe8;padding:6px;margin-bottom:7px}.new{color:#244f39;background:#e5f1e8;padding:6px}
.primary{background:#174d42;border-color:#174d42;color:white}.guide{margin-top:14px;background:#e8f1ec;border-left:3px solid #567a62;border-radius:3px;padding:12px;font-size:12px}
.guide strong{display:block;margin-bottom:5px}.guide p{color:#3d5c51;line-height:1.65}.export{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:15px}.export small{color:var(--muted);font-size:10px}
aside.sources{border-left:1px solid var(--line);background:#f8fbf9;padding:23px 17px;min-width:0}.sources h2{font-size:14px;margin-bottom:15px}.source{border:1px solid var(--line);background:white;border-radius:5px;padding:12px;margin:10px 0}
.source h3{font-size:11px;margin-bottom:6px}.source p{font-size:11px;color:#3d5c51;white-space:pre-wrap;overflow-wrap:anywhere}.source a{font-size:11px;display:inline-block;margin-top:7px}.note{font-size:10px;color:var(--muted);margin-top:15px}
.feedback{font-size:11px;color:#285347;margin-top:10px}.source button{margin-top:9px}.mobile-list{display:none}
:focus-visible{outline:2px solid #467a68;outline-offset:3px}[hidden]{display:none!important}
@media(max-width:1100px){.shell{grid-template-columns:186px minmax(0,1fr)}.layout{grid-template-columns:minmax(0,1fr) 250px}.sidebar{padding-inline:11px}}
@media(max-width:850px){.layout{grid-template-columns:minmax(0,1fr)}aside.sources{border-left:0;border-top:1px solid var(--line)}.sources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.sources>h2,.sources>.note{grid-column:1/-1}.source{margin:0}}
@media(max-width:590px){.shell{grid-template-columns:minmax(0,1fr)}.sidebar{display:none}.mobile-list{display:block}.topbar{padding:12px 16px}h1{font-size:27px}.banner{padding:8px 14px}.sources{display:block}.source{margin:9px 0}.paper{padding:15px}.section-head{align-items:flex-start}.meta{gap:5px}.mobile-list select{max-width:100%;font:inherit;padding:5px;border:1px solid var(--line)}}
</style></head><body>
<div class="banner"><strong>Bản xem trước có hướng dẫn</strong><span>Hồ sơ và quyết định duyệt được mô phỏng. Bản chạy MVP dùng mô hình cục bộ.</span><a href="HUONG-DAN.html">Hướng dẫn mở MVP</a></div>
<div class="shell"><nav class="sidebar" aria-label="Hồ sơ mô phỏng"><div><img class="logo" src="__LOGO__" alt="DAITIN Lawyers and Consultants"><p class="brand-note">Copilot sở hữu trí tuệ</p></div><h2>Hồ sơ dùng thử</h2><div id="case-list"></div><p class="side-note">Nhận diện từ nguồn chính thức Đại Tín.<br>Tiến trình xem trước được lưu trong trình duyệt.</p></nav>
<div class="body"><header class="topbar"><span>Hồ sơ nhãn hiệu &nbsp; / &nbsp; <b id="reference"></b></span><div class="mobile-list"><label>Hồ sơ <select id="mobile-cases"></select></label></div><span id="saved">Đã lưu trên trình duyệt</span></header>
<div class="layout"><main><p class="context">VN · Nhãn hiệu quốc gia · Phản hồi thẩm định</p><h1 id="title"></h1><div class="meta"><span id="received"></span><span id="asof"></span></div>
<div class="tour"><button id="phase-1" type="button" aria-pressed="true">Phiên 1 · Bản đã duyệt</button><button id="phase-2" type="button" aria-pressed="false">Phiên 2 · Chỉ dẫn mới</button></div>
<article class="paper"><h2>Văn bản phản hồi thông báo thẩm định</h2><p id="caption"></p><div id="sections"></div></article>
<div class="guide"><strong id="guide-title"></strong><p id="guide-copy"></p></div>
<div class="export"><button class="primary" id="download-word" type="button">Tải Word đã duyệt</button><small id="export-note"></small></div><p id="feedback" class="feedback" role="status"></p>
</main><aside class="sources" aria-label="Nguồn và căn cứ"><h2>Đối chiếu hồ sơ</h2><div class="source"><h3>Thông báo thẩm định mô phỏng</h3><p id="notice"></p><button id="download-pdf" type="button">Mở PDF nguồn</button></div><div class="source"><h3 id="instructions-heading">Chỉ dẫn khách hàng</h3><p id="instructions"></p></div><div class="source" id="legal"></div><p class="note">Kho căn cứ thử nghiệm đối chiếu đến 10/11/2026. Luật sư rà soát dữ kiện và nội dung trước khi dùng với hồ sơ thực tế.</p></aside></div></div></div>
<script>
const data=__DATA__;
const $=id=>document.getElementById(id);
const key='daitin-ceo-preview-v1';
let memory={reference:data.seed.cases[0].matter.reference,phase:1,approved:false};
try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&data.seed.cases.some(c=>c.matter.reference===saved.reference))memory={...memory,...saved};}catch{}
function save(){try{localStorage.setItem(key,JSON.stringify(memory));$('saved').textContent='Đã lưu tiến trình xem trước';}catch{$('saved').textContent='Tiến trình trong phiên này';}}
function text(tag,value,cls){const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;}
function active(){return data.seed.cases.find(c=>c.matter.reference===memory.reference);}
function file(name,type){const bytes=Uint8Array.from(atob(data.files[name]),c=>c.charCodeAt(0));return new Blob([bytes],{type});}
function download(name,type){const link=document.createElement('a');link.href=URL.createObjectURL(file(name,type));link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),2000);}
const names={findings:'Yêu cầu làm rõ',response:'Nội dung phản hồi',attachments:'Tài liệu kèm theo'};
function render(){
 const sample=active(),matter=sample.matter;
 const states=data.states[memory.reference];
 const phase=states?memory.phase:1;
 const release=states?(phase===1?states.first:states.second).releases.at(-1):null;
 $('reference').textContent=matter.reference;$('title').textContent=matter.title;
 $('received').textContent='Tiếp nhận '+matter.facts.receivedOn.split('-').reverse().join('/');
 $('asof').textContent='Đối chiếu '+matter.facts.asOf.split('-').reverse().join('/');
 $('phase-1').setAttribute('aria-pressed',String(phase===1));$('phase-2').setAttribute('aria-pressed',String(phase===2));$('phase-2').disabled=!states;
 $('caption').textContent=release?'Bản duyệt nội bộ '+phase+' · Mô phỏng':'Nguồn đã chuẩn bị để thử trên bộ chạy MVP';
 const sections=$('sections');sections.replaceChildren();
 if(release)for(const [i,[id,title]] of Object.entries(names).entries()){
  const part=document.createElement('section');part.className='section';
  const head=document.createElement('div');head.className='section-head';
  const pending=phase===2&&id==='response'&&!memory.approved;
  head.append(text('h3',String(i+1).padStart(2,'0')+'  '+title),text('span',pending?'Chờ duyệt':'Đã duyệt (mô phỏng)','badge'+(pending?' pending':'')));part.append(head);
  const content=release.sections[id].text;
  if(phase===2&&id==='response'){part.append(text('p',states.first.releases[0].sections.response.text,'old'),text('p',content,'new'));}
  else part.append(text('p',content));
  if(pending){const approve=text('button','Duyệt nội dung phản hồi','primary');approve.type='button';approve.style.marginTop='10px';approve.onclick=()=>{memory.approved=true;save();render();$('feedback').textContent='Đã duyệt riêng phần phản hồi. Các phần đã duyệt trong phiên 1 được giữ lại.';};part.append(approve);}
  sections.append(part);
 }else sections.append(text('p','Hồ sơ này có PDF nguồn, chỉ dẫn và căn cứ để tiếp nhận, soạn và rà soát trên bộ chạy MVP.'));
 $('guide-title').textContent=phase===1?'Bắt đầu từ nguồn và bản đã duyệt':'Tiếp tục đúng hồ sơ ở phiên sau';
 $('guide-copy').textContent=phase===1?'Mở nguồn ở bên phải và tải Word bản 1. Chọn Phiên 2 để xem chỉ dẫn bổ sung và duyệt riêng phần phản hồi.':'Đối chiếu phần cũ và mới, duyệt nội dung phản hồi rồi tải Word bản 2. Tiến trình duyệt được lưu trên trình duyệt để có thể mở lại.';
 $('notice').textContent=matter.sources[0].text;
 $('instructions-heading').textContent=phase===2?'Chỉ dẫn bổ sung':'Chỉ dẫn khách hàng';
 $('instructions').textContent=phase===2?states.second.sources.at(-1).text:matter.sources[1].text;
 const legal=$('legal');legal.replaceChildren(text('h3','Căn cứ đã lưu'));
 for(const c of matter.basis.citations){legal.append(text('p',c.locator+' · '+c.document+' · trang PDF '+c.page));const a=text('a','Mở nguồn chính thức');a.href=c.originalUrl;a.target='_blank';a.rel='noopener noreferrer';legal.append(a);}
 $('download-word').disabled=!release||(phase===2&&!memory.approved);
 $('download-word').textContent='Tải Word bản '+phase;
 $('export-note').textContent=phase===2&&!memory.approved?'Duyệt phần phản hồi để xuất đúng bản.':'Mẫu Word nhận diện Đại Tín, có thể chỉnh sửa.';
 for(const b of document.querySelectorAll('[data-case]'))b.setAttribute('aria-current',String(b.dataset.case===memory.reference));
 $('mobile-cases').value=memory.reference;
 $('feedback').textContent='';
 save();
}
for(const item of data.seed.cases){
 const m=item.matter,b=text('button','','matter');b.type='button';b.dataset.case=m.reference;b.append(text('strong',m.title),text('small',m.reference));b.onclick=()=>{memory={reference:m.reference,phase:1,approved:false};render();};$('case-list').append(b);
 const option=text('option',m.title);option.value=m.reference;$('mobile-cases').append(option);
}
$('mobile-cases').onchange=()=>{memory={reference:$('mobile-cases').value,phase:1,approved:false};render();};
$('phase-1').onclick=()=>{memory.phase=1;render();};
$('phase-2').onclick=()=>{memory.phase=2;render();};
$('download-word').onclick=()=>{if($('download-word').disabled)return;download(memory.reference+'-ban-'+memory.phase+'.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document');$('feedback').textContent='Đã tải đúng bản duyệt '+memory.phase+'.';};
$('download-pdf').onclick=()=>download(active().pdf,'application/pdf');
render();
</script></body></html>"""
page = page.replace('__LOGO__', logo).replace('__FONTS__', fonts).replace('__DATA__', payload)
target.write_text(page)
print(target)
