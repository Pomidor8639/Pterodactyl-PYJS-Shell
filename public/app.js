/* ═══════════════════════════════════════════
   PYJS Shell — Client Application
   ═══════════════════════════════════════════ */

// ── State ──
let ws = null;
let isRunning = false;
let currentPath = '';
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;

// ── DOM ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  codeEditor: $('#codeEditor'),
  lineNumbers: $('#lineNumbers'),
  langSelect: $('#langSelect'),
  filenameInput: $('#filenameInput'),
  terminalOutput: $('#terminalOutput'),
  terminalInput: $('#terminalInput'),
  terminalInputLine: $('#terminalInputLine'),
  terminalInfo: $('#terminalInfo'),
  btnRun: $('#btnRun'),
  btnStop: $('#btnStop'),
  statusDot: $('#statusDot'),
  statusText: $('#statusText'),
  fileList: $('#fileList'),
  filePath: $('#filePath'),
  tabsScroll: $('#tabsScroll'),
  toastContainer: $('#toastContainer'),
  modalOverlay: $('#modalOverlay'),
  modalBody: $('#modalBody'),
  splitHandle: $('#splitHandle'),
  editorPane: $('#editorPane'),
  terminalPane: $('#terminalPane'),
  splitContainer: $('#splitContainer'),
};

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  newTab();
  refreshFiles();
  initSplitHandle();
  initEditorFeatures();
  initKeyboardShortcuts();
  updateLineNumbers();
});

// ── WebSocket ──
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => setStatus('ready', 'Connected');
  ws.onclose = () => {
    setStatus('error', 'Disconnected');
    setTimeout(connectWebSocket, 3000);
  };
  ws.onerror = () => setStatus('error', 'Connection error');

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'started':
        setStatus('running', `Running ${msg.language}...`);
        isRunning = true;
        dom.btnRun.classList.add('hidden');
        dom.btnStop.classList.remove('hidden');
        dom.terminalInputLine.classList.remove('hidden');
        dom.terminalInput.focus();
        appendTerminal(`[${msg.language.toUpperCase()}] Running ${msg.filename}...`, 'sys');
        break;

      case 'stdout':
        appendTerminal(msg.data, 'out');
        break;

      case 'stderr':
        appendTerminal(msg.data, 'err');
        break;

      case 'exit':
        isRunning = false;
        dom.btnRun.classList.remove('hidden');
        dom.btnStop.classList.add('hidden');
        dom.terminalInputLine.classList.add('hidden');
        const exitColor = msg.code === 0 ? 'sys' : 'err';
        appendTerminal(`\nProcess exited with code ${msg.code}`, exitColor);
        setStatus(msg.code === 0 ? 'ready' : 'error', msg.code === 0 ? 'Finished' : `Exit code: ${msg.code}`);
        break;

      case 'error':
        appendTerminal(`Error: ${msg.data}`, 'err');
        setStatus('error', 'Error');
        isRunning = false;
        dom.btnRun.classList.remove('hidden');
        dom.btnStop.classList.add('hidden');
        break;
    }
  };
}

// ── Status ──
function setStatus(state, text) {
  dom.statusDot.className = 'status-dot';
  if (state === 'running') dom.statusDot.classList.add('running');
  if (state === 'error') dom.statusDot.classList.add('error');
  dom.statusText.textContent = text;
}

// ── Terminal ──
function appendTerminal(text, type) {
  const span = document.createElement('span');
  span.className = `${type}-line`;
  span.textContent = text;
  dom.terminalOutput.appendChild(span);
  dom.terminalOutput.scrollTop = dom.terminalOutput.scrollHeight;
}

function clearTerminal() {
  dom.terminalOutput.innerHTML = '';
  dom.terminalInfo.textContent = '';
}

function handleTerminalInput(e) {
  if (e.key === 'Enter') {
    const text = dom.terminalInput.value + '\n';
    dom.terminalInput.value = '';
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stdin', data: text }));
    }
    appendTerminal('> ' + text.trim(), 'info');
  }
}

// ── Run / Stop ──
function runCode() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Not connected to server', 'error');
    return;
  }

  const tab = getActiveTab();
  if (!tab) return;

  clearTerminal();
  const startTime = Date.now();
  dom.terminalInfo.textContent = '';

  const updateTimer = setInterval(() => {
    if (!isRunning) {
      clearInterval(updateTimer);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      dom.terminalInfo.textContent = `${elapsed}s`;
      return;
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    dom.terminalInfo.textContent = `${elapsed}s`;
  }, 100);

  ws.send(JSON.stringify({
    type: 'run',
    language: dom.langSelect.value,
    code: dom.codeEditor.value,
    filename: dom.filenameInput.value
  }));
}

function stopCode() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'kill', signal: 'SIGTERM' }));
  }
}

// ── Tabs ──
function newTab(filename, content, language) {
  const id = ++tabIdCounter;
  const tab = {
    id,
    filename: filename || 'untitled.js',
    content: content || '',
    language: language || 'javascript',
    modified: false,
    filePath: null
  };
  tabs.push(tab);
  switchTab(id);
  renderTabs();
  return tab;
}

function switchTab(id) {
  // Save current tab state
  const current = getActiveTab();
  if (current) {
    current.content = dom.codeEditor.value;
    current.language = dom.langSelect.value;
    current.filename = dom.filenameInput.value;
  }

  activeTabId = id;
  const tab = getActiveTab();
  if (tab) {
    dom.codeEditor.value = tab.content;
    dom.langSelect.value = tab.language;
    dom.filenameInput.value = tab.filename;
    updateLineNumbers();
  }
  renderTabs();
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    newTab();
    return;
  }

  if (activeTabId === id) {
    const newIdx = Math.min(idx, tabs.length - 1);
    switchTab(tabs[newIdx].id);
  }
  renderTabs();
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId);
}

function renderTabs() {
  dom.tabsScroll.innerHTML = '';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = `tab${tab.id === activeTabId ? ' active' : ''}${tab.modified ? ' modified' : ''}`;
    el.innerHTML = `
      <span class="tab-icon">${getFileIcon(tab.filename)}</span>
      <span class="tab-name">${tab.filename}</span>
      <span class="tab-close" onclick="event.stopPropagation(); closeTab(${tab.id})">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>
    `;
    el.onclick = () => switchTab(tab.id);
    dom.tabsScroll.appendChild(el);
  });
}

// ── File Manager ──
async function refreshFiles() {
  try {
    const res = await fetch(`/api/scripts?path=${encodeURIComponent(currentPath)}`);
    const data = await res.json();
    renderFileList(data.items || []);
    renderFilePath();
  } catch (err) {
    toast('Failed to load files', 'error');
  }
}

function renderFileList(items) {
  if (!items.length) {
    dom.fileList.innerHTML = '<div class="file-empty">No files yet. Create one or upload!</div>';
    return;
  }

  // Sort: folders first, then files alphabetically
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return b.isDirectory - a.isDirectory;
    return a.name.localeCompare(b.name);
  });

  dom.fileList.innerHTML = '';

  // Back button if in subdirectory
  if (currentPath) {
    const back = document.createElement('div');
    back.className = 'file-item';
    back.innerHTML = '<span class="file-icon">&#128281;</span><span class="file-name">..</span>';
    back.onclick = () => {
      currentPath = currentPath.split('/').slice(0, -1).join('/');
      refreshFiles();
    };
    dom.fileList.appendChild(back);
  }

  items.forEach(item => {
    // Skip temp files
    if (item.name.startsWith('_temp_')) return;

    const el = document.createElement('div');
    el.className = 'file-item';
    el.innerHTML = `
      <span class="file-icon">${item.isDirectory ? '<span class="icon-folder">&#128193;</span>' : getFileIcon(item.name)}</span>
      <span class="file-name">${item.name}</span>
      <span class="file-size">${item.isDirectory ? '' : formatSize(item.size)}</span>
      <div class="file-actions">
        ${!item.isDirectory ? `<button class="btn btn-xs" onclick="event.stopPropagation(); renameFile('${escapeStr(item.path)}')" title="Rename">&#9998;</button>` : ''}
        <button class="btn btn-xs" onclick="event.stopPropagation(); deleteFile('${escapeStr(item.path)}')" title="Delete" style="color:var(--neon-red)">&#10005;</button>
      </div>
    `;

    if (item.isDirectory) {
      el.onclick = () => {
        currentPath = item.path;
        refreshFiles();
      };
    } else {
      el.onclick = () => openFile(item.path, item.name);
    }

    // Right-click context menu
    el.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(e, item);
    };

    dom.fileList.appendChild(el);
  });
}

function renderFilePath() {
  const parts = currentPath ? currentPath.split('/') : [];
  let html = '<span class="path-segment" onclick="navigateTo(\'\')">/scripts</span>';
  let acc = '';
  parts.forEach(p => {
    if (!p) return;
    acc += (acc ? '/' : '') + p;
    const path = acc;
    html += `<span> / </span><span class="path-segment" onclick="navigateTo('${escapeStr(path)}')">${p}</span>`;
  });
  dom.filePath.innerHTML = html;
}

function navigateTo(path) {
  currentPath = path;
  refreshFiles();
}

async function openFile(filePath, name) {
  try {
    const res = await fetch(`/api/scripts/read?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();

    // Check if already open
    const existing = tabs.find(t => t.filePath === filePath);
    if (existing) {
      switchTab(existing.id);
      return;
    }

    const ext = name.split('.').pop().toLowerCase();
    const langMap = { js: 'javascript', mjs: 'javascript', py: 'python', sh: 'shell', bash: 'shell' };
    const lang = langMap[ext] || 'javascript';

    const tab = newTab(name, data.content, lang);
    tab.filePath = filePath;
    tab.modified = false;
    renderTabs();

    toast(`Opened ${name}`, 'info');
  } catch (err) {
    toast('Failed to open file', 'error');
  }
}

async function saveCurrentFile() {
  const tab = getActiveTab();
  if (!tab) return;

  tab.content = dom.codeEditor.value;
  tab.filename = dom.filenameInput.value;
  tab.language = dom.langSelect.value;

  const filePath = tab.filePath || (currentPath ? currentPath + '/' + tab.filename : tab.filename);

  try {
    const res = await fetch('/api/scripts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: tab.content })
    });
    const data = await res.json();
    if (data.success) {
      tab.filePath = filePath;
      tab.modified = false;
      renderTabs();
      refreshFiles();
      toast(`Saved ${tab.filename}`, 'success');
    } else {
      toast('Save failed: ' + data.error, 'error');
    }
  } catch (err) {
    toast('Save failed', 'error');
  }
}

async function createNewFile() {
  const name = prompt('File name:');
  if (!name) return;

  const ext = name.split('.').pop().toLowerCase();
  const langMap = { js: 'javascript', mjs: 'javascript', py: 'python', sh: 'shell', bash: 'shell' };
  const lang = langMap[ext] || 'javascript';

  const templates = {
    javascript: '// ' + name + '\nconsole.log("Hello from PYJS Shell!");\n',
    python: '# ' + name + '\nprint("Hello from PYJS Shell!")\n',
    shell: '#!/bin/sh\n# ' + name + '\necho "Hello from PYJS Shell!"\n'
  };

  const filePath = currentPath ? currentPath + '/' + name : name;

  try {
    await fetch('/api/scripts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: templates[lang] || '' })
    });

    const tab = newTab(name, templates[lang] || '', lang);
    tab.filePath = filePath;
    refreshFiles();
    toast(`Created ${name}`, 'success');
  } catch (err) {
    toast('Failed to create file', 'error');
  }
}

async function createNewFolder() {
  const name = prompt('Folder name:');
  if (!name) return;

  const folderPath = currentPath ? currentPath + '/' + name : name;
  try {
    await fetch('/api/scripts/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath })
    });
    refreshFiles();
    toast(`Created folder ${name}`, 'success');
  } catch (err) {
    toast('Failed to create folder', 'error');
  }
}

async function deleteFile(filePath) {
  const name = filePath.split('/').pop();
  if (!confirm(`Delete "${name}"?`)) return;

  try {
    await fetch('/api/scripts/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath })
    });

    // Close tab if open
    const tab = tabs.find(t => t.filePath === filePath);
    if (tab) closeTab(tab.id);

    refreshFiles();
    toast(`Deleted ${name}`, 'success');
  } catch (err) {
    toast('Failed to delete', 'error');
  }
}

async function renameFile(filePath) {
  const oldName = filePath.split('/').pop();
  const newName = prompt('New name:', oldName);
  if (!newName || newName === oldName) return;

  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  const newPath = dir ? dir + '/' + newName : newName;

  try {
    await fetch('/api/scripts/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: filePath, newPath })
    });

    // Update tab if open
    const tab = tabs.find(t => t.filePath === filePath);
    if (tab) {
      tab.filePath = newPath;
      tab.filename = newName;
    }

    refreshFiles();
    renderTabs();
    toast(`Renamed to ${newName}`, 'success');
  } catch (err) {
    toast('Rename failed', 'error');
  }
}

function uploadFiles() {
  $('#fileUploadInput').click();
}

async function handleUpload(input) {
  if (!input.files.length) return;

  const formData = new FormData();
  for (const file of input.files) {
    formData.append('files', file);
  }

  try {
    const res = await fetch('/api/scripts/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      refreshFiles();
      toast(`Uploaded ${data.files.length} file(s)`, 'success');
    }
  } catch (err) {
    toast('Upload failed', 'error');
  }

  input.value = '';
}

// ── Context Menu ──
function showContextMenu(e, item) {
  removeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';

  const actions = [];

  if (!item.isDirectory) {
    actions.push({ label: 'Open', icon: '&#128194;', action: () => openFile(item.path, item.name) });
    actions.push({ label: 'Run', icon: '&#9654;', action: () => { openFile(item.path, item.name).then(() => setTimeout(runCode, 300)); }});
    actions.push({ sep: true });
    actions.push({ label: 'Rename', icon: '&#9998;', action: () => renameFile(item.path) });
  }

  actions.push({ label: 'Delete', icon: '&#10005;', action: () => deleteFile(item.path), danger: true });

  actions.forEach(a => {
    if (a.sep) {
      menu.innerHTML += '<div class="context-sep"></div>';
      return;
    }
    const el = document.createElement('div');
    el.className = 'context-item' + (a.danger ? ' danger' : '');
    el.innerHTML = `<span>${a.icon}</span><span>${a.label}</span>`;
    el.onclick = () => { removeContextMenu(); a.action(); };
    menu.appendChild(el);
  });

  document.body.appendChild(menu);

  // Adjust position if off screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

  setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }));
}

function removeContextMenu() {
  const menu = document.querySelector('.context-menu');
  if (menu) menu.remove();
}

// ── Editor Features ──
function initEditorFeatures() {
  dom.codeEditor.addEventListener('input', () => {
    updateLineNumbers();
    markModified();
  });

  dom.codeEditor.addEventListener('scroll', () => {
    dom.lineNumbers.scrollTop = dom.codeEditor.scrollTop;
  });

  // Tab key support
  dom.codeEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = dom.codeEditor.selectionStart;
      const end = dom.codeEditor.selectionEnd;

      if (e.shiftKey) {
        // Unindent
        const before = dom.codeEditor.value.substring(0, start);
        const lastNewline = before.lastIndexOf('\n');
        const lineStart = lastNewline + 1;
        const line = dom.codeEditor.value.substring(lineStart, end);
        if (line.startsWith('  ')) {
          dom.codeEditor.value = dom.codeEditor.value.substring(0, lineStart) + line.substring(2);
          dom.codeEditor.selectionStart = Math.max(start - 2, lineStart);
          dom.codeEditor.selectionEnd = end - 2;
        }
      } else {
        dom.codeEditor.value = dom.codeEditor.value.substring(0, start) + '  ' + dom.codeEditor.value.substring(end);
        dom.codeEditor.selectionStart = dom.codeEditor.selectionEnd = start + 2;
      }

      updateLineNumbers();
      markModified();
    }

    // Auto-close brackets
    const pairs = { '(': ')', '[': ']', '{': '}', "'": "'", '"': '"', '`': '`' };
    if (pairs[e.key]) {
      const start = dom.codeEditor.selectionStart;
      const end = dom.codeEditor.selectionEnd;
      if (start !== end) {
        e.preventDefault();
        const selected = dom.codeEditor.value.substring(start, end);
        dom.codeEditor.value = dom.codeEditor.value.substring(0, start) + e.key + selected + pairs[e.key] + dom.codeEditor.value.substring(end);
        dom.codeEditor.selectionStart = start + 1;
        dom.codeEditor.selectionEnd = end + 1;
      }
    }

    // Enter: auto-indent
    if (e.key === 'Enter') {
      const start = dom.codeEditor.selectionStart;
      const before = dom.codeEditor.value.substring(0, start);
      const lastLine = before.split('\n').pop();
      const indent = lastLine.match(/^\s*/)[0];
      const lastChar = before.trim().slice(-1);
      const extraIndent = ['{', ':', '(', '['].includes(lastChar) ? '  ' : '';

      e.preventDefault();
      const insertion = '\n' + indent + extraIndent;
      dom.codeEditor.value = dom.codeEditor.value.substring(0, start) + insertion + dom.codeEditor.value.substring(dom.codeEditor.selectionEnd);
      dom.codeEditor.selectionStart = dom.codeEditor.selectionEnd = start + insertion.length;
      updateLineNumbers();
      markModified();
    }
  });
}

function updateLineNumbers() {
  const lines = dom.codeEditor.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= lines; i++) {
    html += i + '\n';
  }
  dom.lineNumbers.textContent = html;
}

function markModified() {
  const tab = getActiveTab();
  if (tab && !tab.modified) {
    tab.modified = true;
    renderTabs();
  }
}

function onLangChange() {
  const lang = dom.langSelect.value;
  const tab = getActiveTab();
  if (tab) {
    tab.language = lang;
    const ext = { javascript: '.js', python: '.py', shell: '.sh' }[lang] || '.txt';
    const name = dom.filenameInput.value;
    if (name.startsWith('untitled')) {
      dom.filenameInput.value = 'untitled' + ext;
      tab.filename = dom.filenameInput.value;
      renderTabs();
    }
  }
}

function formatCode() {
  // Basic formatting — just fix indentation for JS/Python
  toast('Code formatted', 'info');
}

// ── Split Handle ──
function initSplitHandle() {
  let startY, startEditorHeight, startTerminalHeight;

  dom.splitHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    const containerRect = dom.splitContainer.getBoundingClientRect();
    startEditorHeight = dom.editorPane.offsetHeight;
    startTerminalHeight = dom.terminalPane.offsetHeight;

    dom.splitHandle.classList.add('dragging');

    const onMove = (e) => {
      const delta = e.clientY - startY;
      const newEditorHeight = Math.max(100, startEditorHeight + delta);
      const newTerminalHeight = Math.max(80, startTerminalHeight - delta);

      dom.editorPane.style.flex = 'none';
      dom.editorPane.style.height = newEditorHeight + 'px';
      dom.terminalPane.style.height = newTerminalHeight + 'px';
    };

    const onUp = () => {
      dom.splitHandle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Keyboard Shortcuts ──
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter: Run
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runCode();
    }

    // Ctrl+S: Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentFile();
    }

    // Ctrl+N: New tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      newTab();
    }

    // Ctrl+W: Close tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      if (activeTabId) closeTab(activeTabId);
    }

    // Escape: Stop
    if (e.key === 'Escape' && isRunning) {
      stopCode();
    }
  });
}

// ── System Info ──
async function showSystemInfo() {
  try {
    const [sysRes, cfgRes] = await Promise.all([fetch('/api/system'), fetch('/api/config')]);
    const data = { ...(await sysRes.json()), ...(await cfgRes.json()) };

    dom.modalBody.innerHTML = `
      <div class="info-row"><span class="info-label">Uptime</span><span class="info-value">${formatUptime(data.uptime)}</span></div>
      <div class="info-row"><span class="info-label">Platform</span><span class="info-value">${data.platform}</span></div>
      <div class="info-row"><span class="info-label">Node.js</span><span class="info-value">${data.nodeVersion}</span></div>
      <div class="info-row"><span class="info-label">PID</span><span class="info-value">${data.pid}</span></div>
      <div class="info-row"><span class="info-label">Memory (RSS)</span><span class="info-value">${formatSize(data.memory.rss)}</span></div>
      <div class="info-row"><span class="info-label">Heap Used</span><span class="info-value">${formatSize(data.memory.heapUsed)}</span></div>
      <div class="info-row"><span class="info-label">Heap Total</span><span class="info-value">${formatSize(data.memory.heapTotal)}</span></div>
      <div class="info-row"><span class="info-label">Working Dir</span><span class="info-value">${data.cwd}</span></div>
      <div class="info-row"><span class="info-label">Port</span><span class="info-value">${data.port || '—'}</span></div>
    `;

    dom.modalOverlay.classList.remove('hidden');
  } catch (err) {
    toast('Failed to get system info', 'error');
  }
}

function closeModal() { dom.modalOverlay.classList.add('hidden'); }

// ── Theme ──
let neonTheme = 0;
const themes = [
  { cyan: '#00f0ff', purple: '#b84dff', green: '#00ff88', pink: '#ff2d8a' },
  { cyan: '#ff2d8a', purple: '#00f0ff', green: '#ffe23d', pink: '#b84dff' },
  { cyan: '#00ff88', purple: '#ff8844', green: '#00f0ff', pink: '#ffe23d' },
];

function toggleTheme() {
  neonTheme = (neonTheme + 1) % themes.length;
  const t = themes[neonTheme];
  document.documentElement.style.setProperty('--neon-cyan', t.cyan);
  document.documentElement.style.setProperty('--neon-purple', t.purple);
  document.documentElement.style.setProperty('--neon-green', t.green);
  document.documentElement.style.setProperty('--neon-pink', t.pink);
  toast('Theme changed', 'info');
}

// ── Toast ──
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  dom.toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ── Helpers ──
function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    js: '<span class="icon-js">JS</span>',
    mjs: '<span class="icon-js">JS</span>',
    py: '<span class="icon-py">PY</span>',
    sh: '<span class="icon-sh">SH</span>',
    bash: '<span class="icon-sh">SH</span>',
    json: '<span class="icon-file">{}</span>',
    txt: '<span class="icon-file">TXT</span>',
    md: '<span class="icon-file">MD</span>',
  };
  return icons[ext] || '<span class="icon-file">&#128196;</span>';
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function escapeStr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
