# Harness

An open-source HTTP proxy and web security testing tool. Built for testers who are tired of ZAP's UI and don't want to pay for Burp Pro. Ships as a single binary.

> **Work in progress.** Core tools are stable. macOS builds are untested. Some UI polish and features are still being added.

---

## What's in it

### Proxy
Full MITM HTTP/HTTPS interception.

- Pause requests mid-flight, edit the raw text, then Forward or Drop
- Intercept responses too — modify before the browser sees them
- Forward All clears the queue instantly
- Scope filter — restrict capture to specific hosts (glob or regex)
- History clears on every restart so you start clean
- Click any row for full request + response with Raw / Hex / Render views
- Right-click any row → Send to Repeater / Intruder / SQLMap

### Repeater
Replay and modify individual requests.

- Multiple named tabs
- Follow-redirects toggle
- Response panel: Raw · Hex dump · Rendered HTML · Pretty JSON
- Grep search across response body
- Right-click encode/decode (URL, Base64, HTML entities, hex)

### Intruder
Parameterized fuzzer.

**Modes:**
| Mode | Behaviour |
|---|---|
| Sniper | One payload set, one position at a time |
| Battering Ram | One payload set, all positions simultaneously |
| Pitchfork | Multiple payload sets, advanced in lockstep |
| Cluster Bomb | Multiple payload sets, full cartesian product |

**Payloads:**
- Paste directly or load from file — large files are streamed, not loaded into RAM
- 14 transforms: URL encode/decode, Base64 encode/decode, MD5, SHA-256, Hex encode/decode, HTML encode, Uppercase, Lowercase, Reverse, Prefix, Suffix

**Results:**
- Table: index, payload, status, length, duration, grep matches
- Click any row → modal with Request / Raw / Headers / Body / Hex / Render tabs
- Session tabs — switch between multiple attack configs without losing results

### Crawler
Active spider with a visual graph.

- Follows `<a href>`, `<form action>`, `<script src>`, asset links
- Extracts URLs from inline JS (fetch/XHR patterns)
- Parses JSON responses for embedded path strings
- Infers parent paths — finds `/api/v1/users` from `/api/v1/users/123`
- Wordlist fuzzing — paste paths or load a file to brute-force directories alongside the crawl
- D3 force graph — nodes coloured by status code; 404s are dropped silently
- Click any node → Send to Repeater

### Secrets Scanner
Passive scanner running against proxied traffic.

Scans every response and request body in real time for 14 patterns:

| Pattern | Severity |
|---|---|
| AWS Access Key | Critical |
| GitHub Token | Critical |
| Private Key block | Critical |
| Credit Card number | Critical |
| Slack Token | Critical |
| JWT | High |
| Generic API key | High |
| Password in request body | High |
| Bearer Token | Medium |
| SQL query in response | Medium |
| Stack trace / exception | Medium |
| Debug info leakage | Medium |
| Internal IP | Low |
| Email address | Info |

- Findings appear live as traffic is proxied — no manual scan trigger
- Severity filter, per-pattern toggles
- Expand any row for the snippet in context
- Right-click → Send to Repeater
- CSV export

### Nuclei
Runs your locally installed Nuclei engine against a target, with all scan traffic captured in Harness proxy history.

- Tag filter, severity filter, custom templates path, rate limit
- Streaming output with severity colour coding
- Stop at any time
- Intercept is automatically suspended during scans so it doesn't interfere

### SQLMap
Launches SQLMap against a target, with all SQL test traffic visible in proxy history.

- Send any history entry directly to SQLMap with one click
- Configurable technique, level, risk, DBMS, dump flags
- Streaming output in-app

### Scripts
Runs JavaScript analysis against captured proxy history and crawler data.

- Write arbitrary JS — both `requests` and `crawlNodes` are passed in as arrays
- 9 built-in templates: SQL params, open redirects, JWT tokens, admin paths, error responses, large responses, JSON APIs, POST creds, CORS
- Right-click results → Send to Repeater / Intruder / SQLMap

### Tokens
Session token management for authenticated testing.

- Extraction rules (regex or JSONPath) to pull tokens from responses
- Auto-inject the active token into every proxied request (header, cookie, or body)
- Re-auth macro — define a sequence of requests to re-authenticate; replays automatically on 401 and retries

### Match & Replace
Rewrite rules applied to every request and response.

- Actions: Replace (text or regex) or Remove
- Case-sensitive toggle, URL scope per rule
- Live test panel — paste sample input and preview the output before enabling
- 6 presets: Strip CSP, Strip HSTS, Spoof User-Agent, Disable Accept-Encoding, Flag SQL errors, Add X-Forwarded-For

---

## Install

No prebuilt binaries yet — build from source. The installer script handles all dependencies.

### Windows

```powershell
git clone https://github.com/X0CBAN/Harness
cd Harness
.\scripts\install-deps.ps1
wails build
```

The script installs Go, Node.js, and Wails if they're not already present. Optional prompts for Nuclei and SQLMap.

### Linux (Debian / Ubuntu / Parrot / Kali)

```bash
git clone https://github.com/X0CBAN/Harness
cd Harness
bash scripts/install-deps.sh
```

The script detects your package manager and installs the right webkit2gtk version. On newer distros (webkit2gtk 4.1) the build command is:

```bash
wails build -tags webkit2_41
```

On older distros (webkit2gtk 4.0):

```bash
wails build
```

The install script prints the correct command for your system at the end.

**Manual deps (Debian/Ubuntu/Parrot):**
```bash
# webkit2gtk 4.1 (newer distros — Parrot, Ubuntu 23+, Debian 12+)
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev gcc pkg-config build-essential

# webkit2gtk 4.0 (older distros)
sudo apt install libgtk-3-dev libwebkit2gtk-4.0-dev gcc pkg-config build-essential
```

### macOS

```bash
git clone https://github.com/X0CBAN/Harness
cd Harness
bash scripts/install-deps.sh
wails build
```

Manual deps via Homebrew:
```bash
brew install go node
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
```

> macOS builds are currently untested. If something breaks, open an issue.

---

## Setup

1. Run `harness` (or `harness.exe`) — proxy starts on `127.0.0.1:8080`
2. Install the CA cert (see below)
3. Either:
   - Click **Launch Browser** in the toolbar — opens an isolated Chromium session with the proxy already configured
   - Or configure your existing browser manually to use `127.0.0.1:8080` as HTTP/HTTPS proxy

---

## CA Certificate

Harness generates a local CA on first run. It never leaves your machine.

**Windows:** Settings → Install CA Certificate (one click, imports into CurrentUser trust store for Chrome/Edge)

**macOS:** Settings → Install CA Certificate — runs `sudo security add-trusted-cert` against the System keychain. Restart your browser after.

**Linux:** Settings → Install CA Certificate — copies the cert to `/usr/local/share/ca-certificates/` and runs `update-ca-certificates`. Uses `pkexec` or `sudo`.

**Firefox (all platforms):** Firefox has its own trust store and ignores the system one.
1. Settings → Export Certificate — saves `harness-ca.crt` to your desktop
2. Firefox → Settings → Privacy & Security → View Certificates → Authorities → Import → select the file → check "Trust this CA to identify websites"

---

## Stack

- **Backend:** Go + [goproxy](https://github.com/elazarl/goproxy) + SQLite
- **Frontend:** React + Vite + Zustand
- **Desktop:** [Wails v2](https://wails.io) — native WebView2 on Windows, WebKit on Linux/macOS. No Electron.

```
harness/
├── main.go
├── internal/
│   ├── proxy/        # core proxy, Wails app bindings, match/replace engine
│   ├── cert/         # CA generation, per-host cert caching, OS trust store install
│   ├── history/      # SQLite request/response + crawl node store
│   ├── repeater/     # raw HTTP request replayer
│   ├── intruder/     # fuzzing engine — 4 modes, 14 transforms, streaming payloads
│   ├── crawler/      # HTML/JS/JSON spider
│   ├── tokens/       # token extraction, injection, re-auth macros
│   ├── nuclei/       # Nuclei process management and output streaming
│   └── sqlmap/       # SQLMap process management and output streaming
└── frontend/src/
    ├── pages/        # one file per tab
    ├── stores/       # Zustand state
    ├── components/   # shared utilities (hex dump, body extract, JSON format)
    └── bridge.js     # Wails ↔ Go RPC wrappers
```

---

## Known Issues

- **macOS untested** — builds should work but haven't been run on real hardware yet. [Open an issue](https://github.com/X0CBAN/Harness/issues) if something breaks.
- **Secrets scanner only peeks 32 KB** — responses larger than 32 KB will only be scanned up to that limit. Findings in the tail of a large response will be missed.
- **Launch Browser requires Chromium** — Firefox doesn't support `--ignore-certificate-errors` via CLI flag so it can't be used with the one-click launch. Install Chromium (`sudo apt install chromium`) if the button does nothing.
- **Nuclei and SQLMap must be installed separately** — the installer script offers to install them, but Harness won't run scans if they're not on PATH.

---

## Responsible Use

Only test systems you own or have explicit written permission to test. Unauthorized security testing is illegal.

---

## License

MIT
