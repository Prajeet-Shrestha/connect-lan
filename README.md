# ConnectLAN

A **Finder-inspired LAN file transfer** app — share files, folders, and messages between any devices on the same local network. No cloud, no accounts, no app installs.

> Open a browser on your phone → scan the QR code or type the URL → enter the PIN → start sharing.

## Features

- **File browsing** — Icon view and list view with sort, search, breadcrumb navigation
- **Upload / Download** — Drag-and-drop or button upload, single file or folder download (ZIP)
- **Real-time chat** — instant messaging between all connected devices via WebSocket
- **Device discovery** — see connected devices in the sidebar
- **QR code connect** — scan to connect from a phone instantly
- **PIN authentication** — auto-generated 6-digit PIN, no accounts needed
- **TLS encryption** — auto-generates a self-signed certificate for HTTPS
- **Mobile responsive** — works on phones, tablets, and desktops
- **Security** — CSP headers, rate limiting, path traversal protection, CORS enforcement, optional IP allowlist

## Quick Start

```bash
# Clone
git clone https://github.com/Prajeet-Shrestha/connect-lan.git
cd connect-lan

# Install
npm install

# Run (HTTPS — recommended)
npm start

# Run (HTTP — no TLS)
npm run dev
```

The terminal will display:

```
  ╔═══════════════════════════════════════════╗
  ║         🔗 ConnectLAN v1.0.0              ║
  ╚═══════════════════════════════════════════╝

  🔑 PIN:  482019
  📁 Shared: /Users/you/shared
  💾 Disk:   120.45 GB free of 500.00 GB
  🔒 TLS:    Enabled (HTTPS)

  Access URLs:
    Local:    https://localhost:3000
    en0:      https://192.168.0.102:3000

  📱 Scan to connect from phone:
    ▄▄▄▄▄ ...
```

Open the URL on any device on the same WiFi and enter the PIN.

## CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `--port <n>` | Server port | `3000` |
| `--dir <path>` | Shared directory | `~/shared` |
| `--no-tls` | Disable HTTPS (use HTTP) | TLS enabled |
| `--pin <code>` | Set a custom PIN | Auto-generated |
| `--allow-ip <ip>` | Restrict access to specific IPs (repeatable) | All LAN IPs |

**Examples:**

```bash
# Custom port and directory
node server.js --port 8080 --dir ./my-files

# Fixed PIN for convenience
node server.js --pin 1234

# Restrict to a single device
node server.js --allow-ip 192.168.0.50
```

## Project Structure

```
├── server.js          # Entry point — HTTP/HTTPS server, WebSocket, routing
├── public/
│   ├── index.html     # Single-page app (Finder-style UI)
│   ├── style.css      # Dark mode macOS-inspired styles
│   └── app.js         # Client-side logic (file browser, chat, uploads)
└── src/
    ├── auth.js        # PIN authentication, session cookies
    ├── chat.js        # WebSocket handler, device registry, chat history
    ├── files.js       # File API routes (browse, upload, download, rename, delete)
    ├── security.js    # CSP, CORS, rate limiter, path sanitization, IP allowlist
    └── utils.js       # CLI parser, network utils, file type detection
```

## Requirements

- **Node.js 18+** (only if running from source)
- Devices on the **same local network** (WiFi or Ethernet)

## Download & Run (No Node.js Required)

Pre-built standalone binaries are available — no need to install Node.js.

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `connectlan-macos-arm64` |
| macOS (Intel) | `connectlan-macos-x64` |
| Windows | `connectlan-win-x64.exe` |
| Linux | `connectlan-linux-x64` |

```bash
# macOS / Linux
chmod +x connectlan-macos-arm64
./connectlan-macos-arm64

# Windows
connectlan-win-x64.exe
```

> **macOS Gatekeeper:** If you see "cannot be opened because the developer cannot be verified", run:
> ```bash
> xattr -d com.apple.quarantine connectlan-macos-arm64
> ```

All [CLI options](#cli-options) work the same with the binary (e.g., `./connectlan-macos-arm64 --no-tls --port 8080`).

## Building from Source

Build standalone executables for all platforms:

```bash
# Install dependencies
npm install

# Build all platforms (macOS arm64+x64, Windows x64, Linux x64)
npm run build

# Or build for a specific platform
npm run build:mac-arm64
npm run build:mac-x64
npm run build:win
npm run build:linux
```

Binaries are output to the `dist/` folder (~65 MB each).

> **Note:** The first build downloads the Node.js base binary for each target platform (~40 MB each). These are cached in `~/.pkg-cache/` for subsequent builds.

## License

MIT
