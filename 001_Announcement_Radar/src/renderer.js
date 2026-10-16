const api = window.noticeWatch;
let state = { settings: {}, browsers: [], sources: [], notices: [] };
let currentFilter = 'all';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const relative = iso => {
  if (!iso) return '尚未检查'; const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return '刚刚'; if (diff < 3600000) return `${Math.floor(diff/60000)} 分钟前`; if (diff < 86400000) return `${Math.floor(diff/3600000)} 小时前`;
  return new Date(iso).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
};
function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),2600); }
function browserOptions(includeFollow=false) { return `${includeFollow?'<option value="">跟随 APP 默认设置</option>':''}${state.browsers.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}`; }

function render() {
  const unread = state.notices.filter(n=>!n.read).length;
  const today = new Date().toDateString();
  $('unreadBadge').textContent=unread; $('unreadBadge').style.display=unread?'':'none';
  $('statUnread').textContent=unread; $('statSources').textContent=state.sources.length;
  $('statToday').textContent=state.notices.filter(n=>new Date(n.foundAt).toDateString()===today).length;
  $('scheduleLabel').textContent=`每 ${state.settings.intervalMinutes || 30} 分钟自动检查`;
  renderNotices(); renderSources(); renderSettings();
}
function renderNotices() {
  const items=state.notices.filter(n=>currentFilter==='all'||!n.read);
  $('noticeList').innerHTML=items.length?items.map(n=>`<article class="notice ${n.read?'read':''}" data-id="${n.id}"><span class="unread-dot"></span><div><h3>${esc(n.title)}</h3><div class="meta">${esc(n.sourceName)} · ${n.date?esc(n.date)+' · ':''}${relative(n.foundAt)}</div><div class="summary">${esc(n.summary)}</div></div><div class="notice-actions"><button class="icon-btn open-notice" title="打开原文">↗</button><button class="icon-btn read-notice" title="${n.read?'标为未读':'标为已读'}">${n.read?'○':'✓'}</button></div></article>`).join(''):`<div class="empty"><strong>${currentFilter==='unread'?'没有未读公告':'还没有发现新公告'}</strong>${state.sources.length?'下一次检查后，新内容会出现在这里。':'请先添加一个公告栏链接开始监测。'}</div>`;
}
function renderSources() {
  $('sourceList').innerHTML=state.sources.length?state.sources.map(s=>`<article class="source-card" data-id="${s.id}"><div class="source-main"><div class="source-icon">${esc((s.name||'网')[0])}</div><div class="source-info"><h3>${esc(s.name)} ${s.enabled?'':'<small>（已暂停）</small>'}</h3><div class="source-url">${esc(s.url)}</div><div class="source-meta"><span class="status ${esc(s.status)}">${s.status==='checking'?'正在检查':s.status==='error'?esc(s.lastError):`上次检查：${relative(s.lastCheckedAt)}`}</span>${s.lastCount?` · 新增 ${s.lastCount} 条`:''}</div></div></div><div class="source-actions"><select class="source-browser" title="此链接的默认浏览器">${browserOptions(true)}</select><button class="btn secondary small open-source" title="使用该链接设置的浏览器打开网页">↗ 打开网页</button><button class="icon-btn edit-source" title="编辑">✎</button><button class="icon-btn scan-source" title="立即检查">⟳</button><button class="icon-btn delete-source" title="删除">×</button></div></article>`).join(''):`<div class="empty"><strong>还没有监测链接</strong>点击右上角“添加链接”，将官网公告栏加入监测。</div>`;
  document.querySelectorAll('.source-card').forEach(card=>{ const s=state.sources.find(x=>x.id===card.dataset.id); card.querySelector('.source-browser').value=s.browser||''; });
}
function renderSettings() {
  $('intervalInput').value=state.settings.intervalMinutes||30; $('notifyInput').checked=state.settings.notify!==false; $('launchInput').checked=Boolean(state.settings.launchAtStartup);
  $('defaultBrowser').innerHTML=browserOptions(); $('defaultBrowser').value=state.settings.defaultBrowser||'system';
  $('sourceBrowser').innerHTML=browserOptions(true);
  $('browserList').innerHTML=state.browsers.map(b=>`<div class="browser-row"><div><b>${esc(b.name)}</b><small>${b.id==='system'?'由操作系统决定':esc(b.executable)}</small></div>${b.id==='system'?'':`<button class="icon-btn remove-browser" data-id="${b.id}" title="移除">×</button>`}</div>`).join('');
}
function setView(view) {
  document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===view)); document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); $(`${view}View`).classList.add('active');
  const info={inbox:['公告收件箱','集中查看所有网站的新公告与摘要'],sources:['监测链接','管理公告来源、状态和专属浏览器'],settings:['设置','调整检查频率、通知与浏览器偏好']}[view]; $('pageTitle').textContent=info[0]; $('pageDesc').textContent=info[1];
}
function showSourceDialog(source) {
  $('sourceForm').reset(); $('sourceId').value=source?.id||''; $('sourceName').value=source?.name||''; $('sourceUrl').value=source?.url||''; $('sourceBrowser').innerHTML=browserOptions(true); $('sourceBrowser').value=source?.browser||''; $('dialogTitle').textContent=source?'编辑监测链接':'添加监测链接'; $('saveSourceBtn').textContent=source?'保存修改':'添加并建立基准'; $('sourceDialog').showModal();
}
async function guarded(button, task) { const old=button?.disabled; if(button)button.disabled=true; try{return await task();}catch(e){toast(e.message||'操作失败');}finally{if(button)button.disabled=old||false;} }

document.querySelectorAll('.nav').forEach(n=>n.addEventListener('click',()=>setView(n.dataset.view)));
document.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));c.classList.add('active');currentFilter=c.dataset.filter;renderNotices();}));
$('addSourceBtn').addEventListener('click',()=>showSourceDialog());
document.querySelectorAll('.close-source-dialog').forEach(button=>button.addEventListener('click',()=>$('sourceDialog').close()));
$('sourceForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('sourceId').value;await guarded($('saveSourceBtn'),async()=>{if(id){await api.updateSource({id,name:$('sourceName').value,url:$('sourceUrl').value,browser:$('sourceBrowser').value});toast('链接已更新');}else{const r=await api.addSource({name:$('sourceName').value,url:$('sourceUrl').value,browser:$('sourceBrowser').value});toast(r.result.error?`已添加，但首次检查失败：${r.result.error}`:'已添加并建立监测基准');}$('sourceDialog').close();});});
$('scanAllBtn').addEventListener('click',e=>guarded(e.currentTarget,async()=>{const r=await api.scanAll();toast(r.busy?'检查正在进行中':`检查完成，发现 ${r.added} 条新公告`);}));
$('clearReadBtn').addEventListener('click',()=>api.clearRead());
$('noticeList').addEventListener('click',e=>{const card=e.target.closest('.notice');if(!card)return;const n=state.notices.find(x=>x.id===card.dataset.id);if(e.target.closest('.open-notice')){api.markRead(n.id,true);api.openUrl(n.url,n.sourceId);}if(e.target.closest('.read-notice'))api.markRead(n.id,!n.read);});
$('sourceList').addEventListener('contextmenu',e=>{const card=e.target.closest('.source-card');if(card){e.preventDefault();api.sourceMenu(card.dataset.id);}});
$('sourceList').addEventListener('change',e=>{if(e.target.classList.contains('source-browser'))api.updateSource({id:e.target.closest('.source-card').dataset.id,browser:e.target.value});});
$('sourceList').addEventListener('click',e=>{const card=e.target.closest('.source-card');if(!card)return;const s=state.sources.find(x=>x.id===card.dataset.id);if(e.target.closest('.open-source'))api.openUrl(s.url,s.id);if(e.target.closest('.edit-source'))showSourceDialog(s);if(e.target.closest('.scan-source'))guarded(e.target.closest('button'),async()=>{const r=await api.scanSource(s.id);toast(r.error?`检查失败：${r.error}`:`检查完成，发现 ${r.added} 条新公告`);});if(e.target.closest('.delete-source')&&confirm(`确定删除“${s.name}”及其公告记录吗？`))api.removeSource(s.id);});
$('intervalInput').addEventListener('change',e=>api.updateSettings({intervalMinutes:e.target.value}));$('notifyInput').addEventListener('change',e=>api.updateSettings({notify:e.target.checked}));$('launchInput').addEventListener('change',e=>api.updateSettings({launchAtStartup:e.target.checked}));$('defaultBrowser').addEventListener('change',e=>api.updateSettings({defaultBrowser:e.target.value}));
$('addBrowserBtn').addEventListener('click',()=>api.addBrowser());$('browserList').addEventListener('click',e=>{const b=e.target.closest('.remove-browser');if(b)api.removeBrowser(b.dataset.id);});
api.onState(next=>{state=next;render();}); api.getState().then(next=>{state=next;render();});
