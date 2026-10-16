const { app, BrowserWindow, ipcMain, Menu, shell, dialog, Notification, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const cheerio = require('cheerio');

let mainWindow;
let state;
let timer;
let scanRunning = false;

const defaultState = () => ({
  settings: { intervalMinutes: 30, defaultBrowser: 'system', notify: true, launchAtStartup: false },
  browsers: [{ id: 'system', name: '系统默认浏览器', executable: '' }],
  sources: [],
  notices: []
});

function statePath() { return path.join(app.getPath('userData'), 'notice-watch-data.json'); }
function loadState() {
  try {
    const loaded = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    state = { ...defaultState(), ...loaded, settings: { ...defaultState().settings, ...(loaded.settings || {}) } };
  } catch { state = defaultState(); }
  detectBrowsers();
}
function saveState() {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  const temp = `${statePath()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(temp, statePath());
}
function emitState() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state:changed', state); }

function detectBrowsers() {
  if (process.platform !== 'win32') return;
  const env = process.env;
  const candidates = [
    ['edge', 'Microsoft Edge', path.join(env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
    ['chrome', 'Google Chrome', path.join(env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['chrome-user', 'Google Chrome', path.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['firefox', 'Mozilla Firefox', path.join(env.PROGRAMFILES || '', 'Mozilla Firefox', 'firefox.exe')]
  ];
  for (const [id, name, executable] of candidates) {
    if (executable && fs.existsSync(executable) && !state.browsers.some(b => b.executable.toLowerCase() === executable.toLowerCase())) {
      state.browsers.push({ id, name, executable });
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 850, minWidth: 980, minHeight: 650,
    title: '公告雷达', backgroundColor: '#f4f7fb',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function normalizeUrl(value) {
  let url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http/https 网页链接');
  parsed.hash = '';
  return parsed.href;
}

function cleanText(value) { return String(value || '').replace(/[\u00a0\s]+/g, ' ').trim(); }
function fingerprint(value) { return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24); }
function canonicalUrl(raw, base) {
  try { const u = new URL(raw, base); u.hash = ''; ['utm_source','utm_medium','utm_campaign','from'].forEach(k => u.searchParams.delete(k)); return u.href; }
  catch { return ''; }
}

async function fetchHtmlOnce(url) {
  const controller = new AbortController();
  // Some government and institutional sites are large or respond slowly.
  // A browser usually waits much longer than our old 18-second limit.
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('html') && !type.includes('xml') && !type.includes('text')) throw new Error('目标不是可读取的网页');
    return { html: await response.text(), finalUrl: response.url };
  } finally { clearTimeout(timeout); }
}

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await fetchHtmlOnce(url); }
    catch (error) {
      lastError = error;
      // Retry only transient connection failures. HTTP/content errors should
      // be reported immediately instead of requesting the site repeatedly.
      if (error.name !== 'AbortError' && !(error instanceof TypeError)) throw error;
    }
  }
  throw lastError;
}

function extractCandidates(html, baseUrl) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg,canvas,iframe').remove();
  const baseHost = new URL(baseUrl).hostname.replace(/^www\./, '');
  const map = new Map();
  $('a[href]').each((_, el) => {
    const title = cleanText($(el).attr('title') || $(el).text());
    if (title.length < 4 || title.length > 180) return;
    const url = canonicalUrl($(el).attr('href'), baseUrl);
    if (!url || !/^https?:/i.test(url)) return;
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, '') !== baseHost) return;
    if (/\.(jpg|jpeg|png|gif|pdf|zip|docx?|xlsx?|mp4)(\?|$)/i.test(u.pathname)) return;
    if (/^(首页|主页|更多|下一页|上一页|登录|注册|English|EN)$/i.test(title)) return;
    const nearby = cleanText($(el).parent().text()).slice(0, 240);
    const dateMatch = nearby.match(/(?:20\d{2}[年./-]\d{1,2}(?:[月./-]\d{1,2}日?)?|\d{1,2}[月./-]\d{1,2}日?)/);
    let score = Math.min(title.length, 40) / 10;
    if (dateMatch) score += 8;
    if (/(公告|通知|公示|新闻|动态|要闻|信息|通告|结果|招标|政策|发布|notice|news|article)/i.test(`${title} ${url}`)) score += 6;
    if (/\/\d{4}\/?\d{0,2}|\d{6,}/.test(url)) score += 3;
    if ($(el).closest('li,article,tr,.news,.list,.item').length) score += 2;
    const existing = map.get(url);
    const item = { title, url, date: dateMatch ? dateMatch[0] : '', score };
    if (!existing || item.score > existing.score) map.set(url, item);
  });
  return [...map.values()].filter(x => x.score >= 5).sort((a,b) => b.score - a.score).slice(0, 120);
}

function summarizeText(text, title) {
  const cleaned = cleanText(text).replace(/(当前位置|打印本页|关闭窗口|字体大小)[：:]?\s*/g, '');
  const sentences = cleaned.split(/(?<=[。！？!?；;])\s*/).map(cleanText).filter(s => s.length >= 18 && s.length <= 240);
  if (!sentences.length) return `发现新信息：《${title}》。请打开原网页查看详情。`;
  const words = `${title} ${sentences.slice(0, 20).join(' ')}`.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,}/g) || [];
  const freq = new Map(); words.forEach(w => freq.set(w.toLowerCase(), (freq.get(w.toLowerCase()) || 0) + 1));
  const ranked = sentences.slice(0, 35).map((s, i) => ({
    s, i, score: (s.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,}/g) || []).reduce((n,w) => n + (freq.get(w.toLowerCase()) || 0), 0) / Math.sqrt(s.length) + (i < 4 ? 4 - i : 0)
  })).sort((a,b) => b.score - a.score).slice(0, 3).sort((a,b) => a.i - b.i);
  return ranked.map(x => x.s).join(' ').slice(0, 520);
}

async function enrichNotice(item) {
  try {
    const { html } = await fetchHtml(item.url);
    const $ = cheerio.load(html);
    $('script,style,noscript,nav,header,footer,aside,form').remove();
    const selectors = ['article', '.article-content', '.content', '.TRS_Editor', '#zoom', '#content', 'main'];
    let text = '';
    for (const sel of selectors) { const candidate = cleanText($(sel).first().text()); if (candidate.length > text.length) text = candidate; }
    if (text.length < 100) text = cleanText($('body').text());
    return summarizeText(text.slice(0, 16000), item.title);
  } catch { return `发现新信息：《${item.title}》。摘要抓取暂时失败，请打开原网页查看详情。`; }
}

async function scanSource(sourceId, manual = false) {
  const source = state.sources.find(s => s.id === sourceId);
  if (!source || (!source.enabled && !manual)) return { added: 0 };
  source.status = 'checking'; source.lastError = ''; emitState();
  try {
    const { html, finalUrl } = await fetchHtml(source.url);
    const candidates = extractCandidates(html, finalUrl);
    if (!candidates.length) throw new Error('未识别到公告链接，请确认该页面无需登录且内容不是完全由脚本动态加载');
    const previous = new Set(source.knownItems || []);
    const currentKeys = candidates.map(x => fingerprint(`${x.url}|${x.title}`));
    let fresh = [];
    if (source.initialized) fresh = candidates.filter((x, i) => !previous.has(currentKeys[i])).slice(0, 20);
    source.knownItems = [...new Set([...currentKeys, ...(source.knownItems || [])])].slice(0, 600);
    source.initialized = true;
    for (const item of fresh.reverse()) {
      const summary = await enrichNotice(item);
      state.notices.unshift({ id: crypto.randomUUID(), sourceId: source.id, sourceName: source.name, ...item, summary, foundAt: new Date().toISOString(), read: false });
    }
    state.notices = state.notices.slice(0, 1000);
    source.lastCheckedAt = new Date().toISOString(); source.status = 'ok'; source.lastCount = fresh.length;
    saveState(); emitState();
    if (fresh.length && state.settings.notify && Notification.isSupported()) {
      new Notification({ title: `发现 ${fresh.length} 条新公告`, body: `${source.name} 有新内容，点击查看摘要。` }).show();
    }
    return { added: fresh.length, baseline: !previous.size };
  } catch (error) {
    source.status = 'error'; source.lastError = error.name === 'AbortError' ? '连接超时' : error.message; source.lastCheckedAt = new Date().toISOString();
    saveState(); emitState(); return { added: 0, error: source.lastError };
  }
}

async function scanAll(manual = false) {
  if (scanRunning) return { busy: true };
  scanRunning = true; let added = 0;
  try { for (const s of state.sources) { const result = await scanSource(s.id, manual); added += result.added || 0; } return { added }; }
  finally { scanRunning = false; }
}
function schedule() {
  clearInterval(timer);
  const ms = Math.max(5, Number(state.settings.intervalMinutes) || 30) * 60000;
  timer = setInterval(() => scanAll(false), ms);
}

function browserFor(sourceId) {
  const source = state.sources.find(s => s.id === sourceId);
  const id = source?.browser || state.settings.defaultBrowser || 'system';
  return state.browsers.find(b => b.id === id) || state.browsers[0];
}
async function openUrl(url, sourceId) {
  const safe = normalizeUrl(url); const browser = browserFor(sourceId);
  if (!browser || browser.id === 'system' || !browser.executable) return shell.openExternal(safe);
  if (!fs.existsSync(browser.executable)) throw new Error(`浏览器程序不存在：${browser.executable}`);
  const child = spawn(browser.executable, [safe], { detached: true, stdio: 'ignore' }); child.unref();
}

app.whenReady().then(() => {
  loadState(); createWindow(); schedule();
  setTimeout(() => scanAll(false), 2500);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('state:get', () => state);
ipcMain.handle('source:add', async (_, input) => {
  const url = normalizeUrl(input.url);
  if (state.sources.some(s => s.url === url)) throw new Error('这个链接已经添加过了');
  const source = { id: crypto.randomUUID(), name: cleanText(input.name) || new URL(url).hostname, url, browser: input.browser || '', enabled: true, initialized: false, knownItems: [], status: 'idle', lastCheckedAt: '', lastError: '', lastCount: 0 };
  state.sources.unshift(source); saveState(); emitState();
  const result = await scanSource(source.id, true); return { source, result };
});
ipcMain.handle('source:update', (_, input) => {
  const source = state.sources.find(s => s.id === input.id); if (!source) throw new Error('链接不存在');
  if (input.name !== undefined) source.name = cleanText(input.name) || source.name;
  if (input.url !== undefined) { const next = normalizeUrl(input.url); if (next !== source.url) { source.url = next; source.initialized = false; source.knownItems = []; } }
  if (input.browser !== undefined) source.browser = input.browser;
  if (input.enabled !== undefined) source.enabled = Boolean(input.enabled);
  saveState(); emitState(); return source;
});
ipcMain.handle('source:remove', (_, id) => { state.sources = state.sources.filter(s => s.id !== id); state.notices = state.notices.filter(n => n.sourceId !== id); saveState(); emitState(); });
ipcMain.handle('scan:source', (_, id) => scanSource(id, true));
ipcMain.handle('scan:all', () => scanAll(true));
ipcMain.handle('notice:read', (_, id, read = true) => { const n = state.notices.find(x => x.id === id); if (n) n.read = read; saveState(); emitState(); });
ipcMain.handle('notice:clear-read', () => { state.notices = state.notices.filter(n => !n.read); saveState(); emitState(); });
ipcMain.handle('settings:update', (_, settings) => {
  state.settings = { ...state.settings, ...settings, intervalMinutes: Math.max(5, Number(settings.intervalMinutes ?? state.settings.intervalMinutes)) };
  app.setLoginItemSettings({ openAtLogin: Boolean(state.settings.launchAtStartup) }); saveState(); schedule(); emitState(); return state.settings;
});
ipcMain.handle('browser:add', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: '选择浏览器程序', properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: '应用程序', extensions: ['exe'] }] : [] });
  if (result.canceled || !result.filePaths[0]) return null;
  const executable = result.filePaths[0]; const existing = state.browsers.find(b => b.executable === executable); if (existing) return existing;
  const browser = { id: crypto.randomUUID(), name: path.basename(executable, path.extname(executable)), executable };
  state.browsers.push(browser); saveState(); emitState(); return browser;
});
ipcMain.handle('browser:remove', (_, id) => { if (id === 'system') return; state.browsers = state.browsers.filter(b => b.id !== id); if (state.settings.defaultBrowser === id) state.settings.defaultBrowser = 'system'; state.sources.forEach(s => { if (s.browser === id) s.browser = ''; }); saveState(); emitState(); });
ipcMain.handle('url:open', (_, { url, sourceId }) => openUrl(url, sourceId));
ipcMain.handle('context:source', (_, sourceId) => {
  const source = state.sources.find(s => s.id === sourceId); if (!source) return;
  Menu.buildFromTemplate([
    { label: '使用设定浏览器打开', click: () => openUrl(source.url, source.id) },
    { label: '立即检查', click: () => scanSource(source.id, true) },
    { label: '复制链接', click: () => clipboard.writeText(source.url) },
    { type: 'separator' },
    { label: source.enabled ? '暂停监测' : '恢复监测', click: () => { source.enabled = !source.enabled; saveState(); emitState(); } }
  ]).popup({ window: mainWindow });
});
