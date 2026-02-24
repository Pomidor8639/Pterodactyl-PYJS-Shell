# PYJS Shell

**Web-based Python & JavaScript shell for Pterodactyl containers**

A cyberpunk-styled web panel that lets you write, manage, and execute Python and JavaScript scripts directly inside a Pterodactyl container — where Python can only run through Node.js.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

---

## Features

- **Dual Language Execution** — Run Python and JavaScript scripts with real-time output via WebSocket
- **Pterodactyl Compatible** — Python runs through a Node.js wrapper when direct execution isn't available
- **Code Editor** — Tab support, line numbers, auto-indent, bracket matching, keyboard shortcuts
- **File Manager** — Create, rename, delete, upload files and folders
- **Live Terminal** — Real-time stdout/stderr streaming, stdin input, process control
- **Cyberpunk UI** — Black background with neon cyan/purple/green glow effects, animated grid background
- **Multi-Tab Editor** — Work on multiple files simultaneously
- **Theme Switcher** — Multiple neon color schemes
- **System Monitor** — View memory usage, uptime, and system information

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (will ask for port on first run)
node app.js

# Or specify port directly
node app.js 896
node app.js --port=896

# Or use environment variable
SERVER_PORT=896 node app.js
```

The port is saved to `config.json` and reused on next launch — just press Enter to keep it.

## Pterodactyl Setup

1. Upload all files to your Pterodactyl server
2. Set the startup command to `node app.js --port=896` (or just `node app.js` and enter port once)
3. Allocate the corresponding port to the server
4. Start the server from the panel

### Egg Configuration

Make sure your egg uses a Node.js Docker image. The shell automatically detects whether Python is available in the container and falls back to a Node.js wrapper if needed.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + Enter` | Run code |
| `Ctrl + S` | Save file |
| `Ctrl + N` | New tab |
| `Ctrl + W` | Close tab |
| `Escape` | Stop running process |
| `Tab` | Indent |
| `Shift + Tab` | Unindent |

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/scripts` | List scripts in directory |
| `GET` | `/api/scripts/read` | Read file content |
| `POST` | `/api/scripts/save` | Save file content |
| `POST` | `/api/scripts/mkdir` | Create directory |
| `DELETE` | `/api/scripts/delete` | Delete file/directory |
| `POST` | `/api/scripts/rename` | Rename file/directory |
| `POST` | `/api/scripts/upload` | Upload files |
| `GET` | `/api/system` | System information |

## WebSocket Protocol

Connect to `/ws` for real-time script execution:

```json
// Run a script
{ "type": "run", "language": "python", "code": "print('hello')", "filename": "test.py" }

// Send stdin
{ "type": "stdin", "data": "input text\n" }

// Kill process
{ "type": "kill", "signal": "SIGTERM" }
```

## Project Structure

```
├── app.js              # Main server (Express + WebSocket)
├── package.json        # Dependencies
├── config.json         # Saved port & settings (auto-generated)
├── public/
│   ├── index.html      # Web panel
│   ├── style.css       # Cyberpunk neon theme
│   └── app.js          # Client-side application
└── scripts/            # User scripts directory
```

## License

MIT
