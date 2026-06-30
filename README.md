# Harness

**A fast, open-source HTTP proxy and web security testing platform.**

Built for testers who are tired of ZAP's clunky UI and don't want to pay $500/year for Burp Pro. Ships as a single binary — no install wizard, no runtime, no dependencies.

![Harness Screenshot](docs/screenshot.png)

---

## Tools

### Proxy
Full MITM HTTP/HTTPS interception with a live history table.

- Pause requests mid-flight, edit the raw text, then **Forward** or **Drop**
- Intercept responses too — inspect and modify before the browser renders them
- **Forward All** clears the entire queue instantly
- Scope filter — restrict capture to hosts you care about (glob or regex)
- History auto-clears on restart so you always start with a clean slate
- Click any history row to open full request + response with hex and live render views
- **Send to Repeater / Intruder / SQLMap** via right-click

### Repeater
Replay and modify any request with instant feedback.

- Multiple named tabs, drag-to-resize request/response split
- Follow-redirects toggle
- Response panel: Raw · Hex dump · Live HTML render · Pretty JSON
- Grep search across the response body
- Selection length counter for quick payload sizing
- Right-click encode/decode helpers (URL, Base64, HTML entities, hex)

### Intruder
High-throughput parameterized fuzzer with session tabs.

**Attack modes:**
| Mode | Behaviour |
|---|---|
| Sniper | One payload set, cycles through marked positions one at a time |
| Battering Ram | One payload set, same value inserted at every position simultaneously |
| Pitchfork | Multiple payload sets, advanced in lockstep |
| Cluster Bomb | Multiple payload sets, every combination (cartesian product) |

**Payloads:**
- Paste lines directly or load from any file — millions of lines are fine, they're streamed from disk and never loaded into RAM
- 14 built-in transforms applied per-payload before substitution:

| Transform | Transform | Transform |
|---|---|---|
| URL encode/decode | Base64 encode/decode | MD5 hash |
| SHA-256 hash | Hex encode/decode | HTML entity encode |
| Uppercase / Lowercase | Reverse string | Prefix / Suffix |

**Results:**
- Table: index, payload, status, length, duration, grep matches
- Click any row → modal with **Request · Response · Hex · Render** tabs
- Grep match — flag responses containing any string; matched strings are highlighted
- **Reset All** clears the entire config (request, payloads, results) in one click

### Crawler
Active site mapper with a visual graph.

- HTML spider — follows `<a href>`, `<form action>`, `<script src>`, `<img src>`, asset links
- JS fetch/XHR extraction — detects API calls in JavaScript source
- JSON response parsing — extracts URL strings from API responses
- Smart parent-path inference — `/api/v1/users/123` automatically queues `/api/v1/users/` and `/api/v1/`
- **Wordlist fuzzing** — paste a path list or load a file to brute-force directories alongside the passive crawl
- **D3 force graph** — nodes coloured by HTTP status; 404s are silently dropped; 401/403 nodes stay (they show the protected surface)
- Click any node → **Send to Repeater**
- Drag nodes to rearrange; graph updates live as new nodes arrive

### Nuclei
One-click active scanning using your locally installed Nuclei engine.

- Automatically points Nuclei at the running Harness proxy so all scan traffic is captured in history
- Tag filter and severity filter (info / low / medium / high / critical)
- Custom templates directory path
- Streaming output with per-severity colour coding
- Stop at any time

### Secrets Scanner
Passive sensitive-data exposure detector — unique to Harness.

Scans every proxied response (and request) in real time for 15 built-in patterns:

| Pattern | Severity |
|---|---|
| JWT Token | High |
| AWS Access Key (`AKIA…`) | Critical |
| GitHub Token (`ghp_`, `gho_`, …) | Critical |
| Private Key (`BEGIN … PRIVATE KEY`) | Critical |
| Credit Card number | Critical |
| Slack Token (`xoxb-…`) | Critical |
| Generic API Key | High |
| Password in request body | High |
| Bearer Token | Medium |
| SQL Query in response | Medium |
| Stack Trace / exception | Medium |
| Debug / framework leakage | Medium |
| Internal IP address | Low |
| Email address | Info |

- **Live mode** — new findings appear the moment a response is proxied; no manual scan needed
- Severity filter chips to focus on what matters
- Per-pattern enable/disable toggles
- Click any row to expand the full 500-char snippet in context
- Right-click → **Send to Repeater** to replay the request
- **CSV export** — dump all findings to a spreadsheet

### Scripts
In-browser JavaScript analysis engine that runs over your captured traffic.

- Access both proxy history entries and crawler nodes from the same script context
- 9 built-in templates: SQL injection params, open redirect params, JWT tokens, admin paths, error messages, API key headers, debug endpoints, CORS misconfigurations, redirect chains
- Write your own analysis in plain JavaScript
- Right-click results → **Send to Repeater · Intruder · SQLMap**

### Tokens
Automatic session-token management for authenticated testing.

- Define extraction rules (regex or JSONPath) to pull tokens from responses
- Auto-inject the active token into every proxy request (header, cookie, or body)
- Re-auth macro — define a sequence of requests to re-authenticate; Harness replays them automatically on 401 and retries the original request

### Match & Replace
Auto-rewrite rules applied to every request and response passing through the proxy.

- Actions: **Replace** (text or regex substitution) or **Remove** (strip the matched field entirely)
- Case-sensitive toggle
- URL scope — restrict a rule to URLs matching a regex pattern
- Comment / note field per rule
- Live test panel — paste sample text and see the transformed output before enabling
- 6 built-in presets: Strip CSP, Strip HSTS, Spoof User-Agent, Disable Accept-Encoding, Flag SQL errors, Add X-Forwarded-For

### SQLMap
Integrated SQLMap launcher.

- Pass any proxied request directly to SQLMap with one click
- Configurable options (technique, level, risk, DBMS, dump flags)
- Streaming output in-app
- Harness proxy used as SQLMap's upstream — all SQL test traffic visible in history

---

## Install

### Prebuilt binary (Windows)

Download `harness.exe` from [Releases](https://github.com/harness-proxy/harness/releases) and double-click. No install required.

### Build from source

**Requirements:** Go 1.21+, Node 18+, [Wails v2](https://wails.io/docs/gettingstarted/installation)

```bash
git clone https://github.com/harness-proxy/harness
cd harness
wails build        # outputs build/bin/harness.exe
```

Development mode with hot reload:

```bash
wails dev
```

---

## Setup

1. Run `harness.exe` — proxy starts on `127.0.0.1:8080`
2. Configure your browser to use `127.0.0.1:8080` as HTTP and HTTPS proxy
   - Chrome/Edge: [FoxyProxy](https://chromewebstore.google.com/detail/foxyproxy/gcknhkkoolaabfmlnjonogaaifnjlfnp) extension
   - Firefox: Settings → Network Settings → Manual proxy
3. Go to **Settings** → click **Install CA to Windows Trust Store** (one click, then restart browser)
4. Browse — traffic appears in the Proxy tab

Or use **Launch Browser** in the toolbar to open an isolated Chrome/Edge session with the proxy already configured — no manual setup needed.

---

## CA Certificate

Harness generates a unique local CA on first run, stored in `%APPDATA%\harness\`. It never leaves your machine.

**Quick install (Windows):** Settings → Install CA to Windows Trust Store

**Firefox** (separate trust store — must import manually):
1. Settings → Export .crt + .pem to Desktop
2. Firefox → Settings → Privacy & Security → View Certificates → Authorities → Import → select `harness-ca.pem` → Trust to identify websites

**Manual Windows install:**
1. Double-click `harness-ca.crt` → Install Certificate
2. Current User → Next → Place in: **Trusted Root Certification Authorities** → OK → Finish
3. Fully restart browser

---

## Architecture

```
harness/
├── main.go                   # Wails entry point
├── internal/
│   ├── proxy/                # Core proxy server, Wails app bindings, match/replace engine
│   ├── cert/                 # Dynamic CA + per-host certificate generation
│   ├── history/              # SQLite request/response + crawl node store
│   ├── repeater/             # Raw HTTP request replayer
│   ├── intruder/             # Fuzzing engine — 4 modes, streaming large files, 14 transforms
│   ├── crawler/              # HTML/JS/JSON spider with parent-path inference
│   ├── tokens/               # Token extraction, injection, and re-auth macros
│   ├── nuclei/               # Nuclei process management and output streaming
│   ├── sqlmap/               # SQLMap process management and output streaming
│   └── testserver/           # Embedded vulnerable test server on :9090
└── frontend/src/
    ├── pages/                # ProxyTab, RepeaterTab, IntruderTab, CrawlerTab,
    │                         # NucleiTab, SecretsTab, ScriptsTab, TokensTab,
    │                         # SQLMapTab, RulesTab, SettingsTab
    ├── stores/               # Zustand global state
    ├── components/           # Shared UI: viewUtils (hex dump, body extract, JSON format)
    └── bridge.js             # Wails ↔ Go RPC wrappers
```

**Stack:** Go + [goproxy](https://github.com/elazarl/goproxy) + SQLite · React + Vite + Zustand · [Wails v2](https://wails.io) (native WebView2, no Electron)

---

## Responsible Use

Harness is for testing systems you own or have explicit written permission to test. Unauthorized security testing is illegal. The authors are not responsible for misuse.

---

## License

MIT
