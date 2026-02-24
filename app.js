const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const multer = require('multer');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const SCRIPTS_DIR = path.join(__dirname, 'scripts');

// ── Config: load / save ──
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch { /* ignore corrupt config */ }
  return {};
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

// ── Ask port interactively ──
function askPort() {
  return new Promise((resolve) => {
    const cfg = loadConfig();
    const saved = cfg.port;

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const prompt = saved
      ? `\x1b[36mEnter port \x1b[0m[\x1b[33m${saved}\x1b[0m — saved, press Enter to reuse]: `
      : `\x1b[36mEnter port \x1b[0m[\x1b[33m896\x1b[0m]: `;

    rl.question(prompt, (answer) => {
      rl.close();
      const input = answer.trim();
      let port;

      if (!input) {
        port = saved || 896;
      } else {
        port = parseInt(input, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          console.log('\x1b[31mInvalid port. Using default 896.\x1b[0m');
          port = 896;
        }
      }

      // Save for next time
      cfg.port = port;
      saveConfig(cfg);

      resolve(port);
    });
  });
}

// ── Resolve port: CLI arg > env > interactive prompt ──
async function resolvePort() {
  // 1. CLI argument: node app.js 8080  or  node app.js --port=8080
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg.startsWith('--port=')) {
      const p = parseInt(arg.split('=')[1], 10);
      if (p >= 1 && p <= 65535) { saveConfig({ ...loadConfig(), port: p }); return p; }
    }
    const p = parseInt(arg, 10);
    if (p >= 1 && p <= 65535) { saveConfig({ ...loadConfig(), port: p }); return p; }
  }

  // 2. Environment variable
  if (process.env.SERVER_PORT) {
    const p = parseInt(process.env.SERVER_PORT, 10);
    if (p >= 1 && p <= 65535) { saveConfig({ ...loadConfig(), port: p }); return p; }
  }

  // 3. Interactive prompt (shows saved port if exists)
  return askPort();
}

// Ensure scripts directory exists
if (!fs.existsSync(SCRIPTS_DIR)) {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Explicit fallback for root
app.get('/', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(500).send(
      `<pre>public/index.html not found.\n\n__dirname: ${__dirname}\npublicDir: ${publicDir}\nexists: ${fs.existsSync(publicDir)}\ncontents: ${fs.existsSync(publicDir) ? fs.readdirSync(publicDir).join(', ') : 'N/A'}\nroot contents: ${fs.readdirSync(__dirname).join(', ')}</pre>`
    );
  }
});

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SCRIPTS_DIR),
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ──────────────────────────────────────────────
// API: List scripts
// ──────────────────────────────────────────────
app.get('/api/scripts', (req, res) => {
  const subdir = req.query.path || '';
  const target = path.join(SCRIPTS_DIR, subdir);
  if (!target.startsWith(SCRIPTS_DIR)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const items = entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(subdir, e.name),
      size: e.isDirectory() ? null : fs.statSync(path.join(target, e.name)).size,
      modified: fs.statSync(path.join(target, e.name)).mtime
    }));
    res.json({ path: subdir, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Read file
app.get('/api/scripts/read', (req, res) => {
  const filePath = path.join(SCRIPTS_DIR, req.query.path || '');
  if (!filePath.startsWith(SCRIPTS_DIR)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content, path: req.query.path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Save file
app.post('/api/scripts/save', (req, res) => {
  const { path: filePath, content } = req.body;
  const target = path.join(SCRIPTS_DIR, filePath);
  if (!target.startsWith(SCRIPTS_DIR)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Create folder
app.post('/api/scripts/mkdir', (req, res) => {
  const target = path.join(SCRIPTS_DIR, req.body.path || '');
  if (!target.startsWith(SCRIPTS_DIR)) return res.status(403).json({ error: 'Forbidden' });
  try {
    fs.mkdirSync(target, { recursive: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Delete file/folder
app.delete('/api/scripts/delete', (req, res) => {
  const target = path.join(SCRIPTS_DIR, req.body.path || '');
  if (!target.startsWith(SCRIPTS_DIR)) return res.status(403).json({ error: 'Forbidden' });
  try {
    fs.rmSync(target, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Rename
app.post('/api/scripts/rename', (req, res) => {
  const src = path.join(SCRIPTS_DIR, req.body.oldPath || '');
  const dst = path.join(SCRIPTS_DIR, req.body.newPath || '');
  if (!src.startsWith(SCRIPTS_DIR) || !dst.startsWith(SCRIPTS_DIR))
    return res.status(403).json({ error: 'Forbidden' });
  try {
    fs.renameSync(src, dst);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Upload
app.post('/api/scripts/upload', upload.array('files', 20), (req, res) => {
  res.json({ success: true, files: req.files.map(f => f.originalname) });
});

// API: System info
app.get('/api/system', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    uptime: process.uptime(),
    platform: process.platform,
    nodeVersion: process.version,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal
    },
    pid: process.pid,
    cwd: process.cwd()
  });
});

// ──────────────────────────────────────────────
// WebSocket: Script execution & live terminal
// ──────────────────────────────────────────────
const activeProcesses = new Map();

wss.on('connection', (ws) => {
  let currentProcess = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'run') {
      const { language, code, filename } = msg;

      // Kill previous process if still running
      if (currentProcess) {
        currentProcess.kill('SIGTERM');
        currentProcess = null;
      }

      let cmd, args, tempFile;

      if (language === 'python') {
        // In Pterodactyl containers: run Python via a JS wrapper that calls child_process
        // This works because the egg only allows node, but python binary may exist
        tempFile = path.join(SCRIPTS_DIR, `_temp_${Date.now()}.py`);
        fs.writeFileSync(tempFile, code);

        // Try direct python first, fallback to node wrapper
        const pythonBins = ['python3', 'python', '/usr/bin/python3', '/usr/bin/python'];
        let pythonPath = null;
        for (const bin of pythonBins) {
          try {
            const result = require('child_process').execSync(`which ${bin} 2>/dev/null`).toString().trim();
            if (result) { pythonPath = result; break; }
          } catch { /* continue */ }
        }

        if (pythonPath) {
          cmd = pythonPath;
          args = ['-u', tempFile];
        } else {
          // Fallback: run python through node child_process wrapper
          const wrapperCode = `
const { spawn } = require('child_process');
const p = spawn('python3', ['-u', ${JSON.stringify(tempFile)}], { stdio: 'inherit' });
p.on('error', () => {
  const p2 = spawn('python', ['-u', ${JSON.stringify(tempFile)}], { stdio: 'inherit' });
  p2.on('error', (e) => { console.error('Python not available:', e.message); process.exit(1); });
  p2.on('exit', (c) => process.exit(c || 0));
});
p.on('exit', (c) => process.exit(c || 0));
`;
          tempFile = path.join(SCRIPTS_DIR, `_temp_${Date.now()}_wrapper.js`);
          fs.writeFileSync(tempFile, wrapperCode);
          cmd = 'node';
          args = [tempFile];
        }
      } else if (language === 'javascript') {
        tempFile = path.join(SCRIPTS_DIR, `_temp_${Date.now()}.js`);
        fs.writeFileSync(tempFile, code);
        cmd = 'node';
        args = [tempFile];
      } else if (language === 'shell') {
        tempFile = path.join(SCRIPTS_DIR, `_temp_${Date.now()}.sh`);
        fs.writeFileSync(tempFile, code);
        cmd = 'sh';
        args = [tempFile];
      } else {
        ws.send(JSON.stringify({ type: 'error', data: `Unknown language: ${language}` }));
        return;
      }

      ws.send(JSON.stringify({ type: 'started', language, filename: filename || 'untitled' }));

      const proc = spawn(cmd, args, {
        cwd: SCRIPTS_DIR,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });

      currentProcess = proc;
      activeProcesses.set(proc.pid, proc);

      proc.stdout.on('data', (data) => {
        ws.send(JSON.stringify({ type: 'stdout', data: data.toString() }));
      });

      proc.stderr.on('data', (data) => {
        ws.send(JSON.stringify({ type: 'stderr', data: data.toString() }));
      });

      proc.on('close', (exitCode) => {
        activeProcesses.delete(proc.pid);
        if (currentProcess === proc) currentProcess = null;

        // Clean up temp files
        try {
          const temps = fs.readdirSync(SCRIPTS_DIR).filter(f => f.startsWith('_temp_'));
          temps.forEach(f => fs.unlinkSync(path.join(SCRIPTS_DIR, f)));
        } catch { /* ignore */ }

        ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      });

      proc.on('error', (err) => {
        ws.send(JSON.stringify({ type: 'error', data: err.message }));
      });

    } else if (msg.type === 'stdin') {
      if (currentProcess && currentProcess.stdin.writable) {
        currentProcess.stdin.write(msg.data);
      }
    } else if (msg.type === 'kill') {
      if (currentProcess) {
        currentProcess.kill(msg.signal || 'SIGTERM');
        currentProcess = null;
      }
    } else if (msg.type === 'resize') {
      // Terminal resize - not applicable for basic spawn
    }
  });

  ws.on('close', () => {
    if (currentProcess) {
      currentProcess.kill('SIGTERM');
      currentProcess = null;
    }
  });
});

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────
(async () => {
  console.log(`\n\x1b[36m╔══════════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  \x1b[35m⚡ PYJS Shell v1.0.0\x1b[0m                        \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m╚══════════════════════════════════════════════╝\x1b[0m\n`);

  const PORT = await resolvePort();

  // API: Get/set port config
  app.get('/api/config', (req, res) => {
    res.json({ port: PORT, config: loadConfig() });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n\x1b[32m  ✓ Server running on port \x1b[33m${PORT}\x1b[0m`);
    console.log(`\x1b[32m  ✓ Python & JavaScript execution ready\x1b[0m`);
    console.log(`\x1b[32m  ✓ WebSocket terminal active\x1b[0m`);
    console.log(`\x1b[32m  ✓ Port saved to config.json\x1b[0m\n`);
  });
})();
