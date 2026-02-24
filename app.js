const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const PORT = process.env.SERVER_PORT || 896;
const SCRIPTS_DIR = path.join(__dirname, 'scripts');

// Ensure scripts directory exists
if (!fs.existsSync(SCRIPTS_DIR)) {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n\x1b[36m╔══════════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  \x1b[35m⚡ PYJS Shell v1.0.0\x1b[0m                        \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  \x1b[32m✓ Server running on port ${PORT}\x1b[0m               \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  \x1b[32m✓ Python & JavaScript execution ready\x1b[0m       \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  \x1b[32m✓ WebSocket terminal active\x1b[0m                 \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m╚══════════════════════════════════════════════╝\x1b[0m\n`);
});
