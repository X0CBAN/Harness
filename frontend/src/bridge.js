// Wails runtime bridge
// In dev mode (browser without Wails), fall back to mock data.

const isMock = !window.wails

// Wait for Wails runtime to be fully ready before making calls
function waitForWails() {
  return new Promise((resolve) => {
    if (window.go?.proxy?.App) {
      resolve()
      return
    }
    // Wails fires this event when the runtime is ready
    window.addEventListener('wails:ready', () => resolve(), { once: true })
    // Fallback poll in case the event already fired
    const interval = setInterval(() => {
      if (window.go?.proxy?.App) {
        clearInterval(interval)
        resolve()
      }
    }, 50)
  })
}

const mockBackend = {
  getHistory: async () => [],
  getEntry: async () => null,
  clearHistory: async () => {},
  setIntercept: async () => {},
  isIntercepting: async () => false,
  forwardRequest: async () => {},
  dropRequest: async () => {},
  modifyAndForward: async () => {},
  setScope: async () => {},
  getCACert: async () => '',
  getCACertDER: async () => new Uint8Array([]),
  installCACert: async () => 'CA installed (mock).',
  openCertForInstall: async () => 'Cert wizard opened (mock).',
  getRules: async () => [],
  setRules: async () => {},
  getProxyPort: async () => '8080',
  sendRepeaterRequest: async () => ({
    statusCode: 200,
    raw: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"ok":true}',
    body: '{"ok":true}',
    durationMs: 142,
  }),
  startIntruder: async () => {},
  stopIntruder: async () => {},
  launchBrowser: async () => 'Browser launched (mock).',
  loadPayloadFile: async () => [],
  openPayloadFile: async () => null,
  startCrawl: async () => {},
  stopCrawl: async () => {},
  getCrawlNodes: async () => [],
  clearCrawlNodes: async () => {},
  getTokenRules: async () => [],
  setTokenRules: async () => {},
  getTokenInjection: async () => ({ enabled: false, target: 'header', key: 'Authorization', format: 'Bearer {{token}}' }),
  setTokenInjection: async () => {},
  getActiveToken: async () => '',
  setActiveToken: async () => {},
  getMacro: async () => [],
  setMacro: async () => {},
  runMacro: async () => '',
  runSQLMap: async () => {},
  stopSQLMap: async () => {},
  saveToFile: async () => {},
  startCrawlWithPaths: async () => {},
  fingerprintTarget: async () => ({ target: '', findings: [], headers: {}, statusCode: 0 }),
  getBrowserRunning: async () => false,
  getNucleiInstalled: async () => false,
  runNuclei: async () => {},
  stopNuclei: async () => {},
  setInterceptResponse: async () => {},
  forwardAllRequests: async () => {},
  forwardResponse: async () => {},
  dropResponse: async () => {},
  modifyAndForwardResponse: async () => {},
  forwardAllResponses: async () => {},
}

// Real backend — wraps window.go calls with runtime-ready guard
const makeRealBackend = () => ({
  getHistory: async (search = '', limit = 200, offset = 0) => {
    await waitForWails()
    return window.go.proxy.App.GetHistory(search, limit, offset)
  },
  getEntry: async (id) => {
    await waitForWails()
    return window.go.proxy.App.GetEntry(id)
  },
  clearHistory: async () => {
    await waitForWails()
    return window.go.proxy.App.ClearHistory()
  },
  setIntercept: async (on) => {
    await waitForWails()
    return window.go.proxy.App.SetIntercept(on)
  },
  isIntercepting: async () => {
    await waitForWails()
    return window.go.proxy.App.IsIntercepting()
  },
  forwardRequest: async (id) => {
    await waitForWails()
    return window.go.proxy.App.ForwardRequest(id)
  },
  dropRequest: async (id) => {
    await waitForWails()
    return window.go.proxy.App.DropRequest(id)
  },
  modifyAndForward: async (id, raw) => {
    await waitForWails()
    return window.go.proxy.App.ModifyAndForward(id, raw)
  },
  setScope: async (patterns) => {
    await waitForWails()
    return window.go.proxy.App.SetScope(patterns)
  },
  getCACert: async () => {
    await waitForWails()
    return window.go.proxy.App.GetCACert()
  },
  getCACertDER: async () => {
    await waitForWails()
    return window.go.proxy.App.GetCACertDER()
  },
  installCACert: async () => {
    await waitForWails()
    return window.go.proxy.App.InstallCACert()
  },
  openCertForInstall: async () => {
    await waitForWails()
    return window.go.proxy.App.OpenCertForInstall()
  },
  getRules: async () => {
    await waitForWails()
    return window.go.proxy.App.GetRules()
  },
  setRules: async (rules) => {
    await waitForWails()
    return window.go.proxy.App.SetRules(rules)
  },
  getProxyPort: async () => {
    await waitForWails()
    return window.go.proxy.App.GetProxyPort()
  },
  sendRepeaterRequest: async (req) => {
    await waitForWails()
    return window.go.proxy.App.SendRepeaterRequest(req)
  },
  startIntruder: async (attack) => {
    await waitForWails()
    return window.go.proxy.App.StartIntruder(attack)
  },
  stopIntruder: async () => {
    await waitForWails()
    return window.go.proxy.App.StopIntruder()
  },
  launchBrowser: async () => {
    await waitForWails()
    return window.go.proxy.App.LaunchHarnessBrowser()
  },
  loadPayloadFile: async () => {
    await waitForWails()
    return window.go.proxy.App.LoadPayloadFile()
  },
  openPayloadFile: async () => {
    await waitForWails()
    return window.go.proxy.App.OpenPayloadFile()
  },
  startCrawl: async (seedURL, maxDepth) => {
    await waitForWails()
    return window.go.proxy.App.StartCrawl(seedURL, maxDepth)
  },
  startCrawlWithPaths: async (seedURL, maxDepth, paths) => {
    await waitForWails()
    return window.go.proxy.App.StartCrawlWithPaths(seedURL, maxDepth, paths)
  },
  stopCrawl: async () => {
    await waitForWails()
    return window.go.proxy.App.StopCrawl()
  },
  getCrawlNodes: async () => {
    await waitForWails()
    return window.go.proxy.App.GetCrawlNodes()
  },
  clearCrawlNodes: async () => {
    await waitForWails()
    return window.go.proxy.App.ClearCrawlNodes()
  },
  fingerprintTarget: async (url) => {
    await waitForWails()
    return window.go.proxy.App.FingerprintTarget(url)
  },
  getTokenRules: async () => {
    await waitForWails()
    return window.go.proxy.App.GetTokenRules()
  },
  setTokenRules: async (rules) => {
    await waitForWails()
    return window.go.proxy.App.SetTokenRules(rules)
  },
  getTokenInjection: async () => {
    await waitForWails()
    return window.go.proxy.App.GetTokenInjection()
  },
  setTokenInjection: async (cfg) => {
    await waitForWails()
    return window.go.proxy.App.SetTokenInjection(cfg)
  },
  getActiveToken: async () => {
    await waitForWails()
    return window.go.proxy.App.GetActiveToken()
  },
  setActiveToken: async (token) => {
    await waitForWails()
    return window.go.proxy.App.SetActiveToken(token)
  },
  getMacro: async () => {
    await waitForWails()
    return window.go.proxy.App.GetMacro()
  },
  setMacro: async (reqs) => {
    await waitForWails()
    return window.go.proxy.App.SetMacro(reqs)
  },
  runMacro: async () => {
    await waitForWails()
    return window.go.proxy.App.RunMacro()
  },
  runSQLMap: async (rawRequest, opts) => {
    await waitForWails()
    return window.go.proxy.App.RunSQLMap(rawRequest, opts)
  },
  stopSQLMap: async () => {
    await waitForWails()
    return window.go.proxy.App.StopSQLMap()
  },
  setInterceptResponse: async (on) => {
    await waitForWails()
    return window.go.proxy.App.SetInterceptResponse(on)
  },
  forwardAllRequests: async () => {
    await waitForWails()
    return window.go.proxy.App.ForwardAllRequests()
  },
  forwardResponse: async (id) => {
    await waitForWails()
    return window.go.proxy.App.ForwardResponse(id)
  },
  dropResponse: async (id) => {
    await waitForWails()
    return window.go.proxy.App.DropResponse(id)
  },
  modifyAndForwardResponse: async (id, raw) => {
    await waitForWails()
    return window.go.proxy.App.ModifyAndForwardResponse(id, raw)
  },
  forwardAllResponses: async () => {
    await waitForWails()
    return window.go.proxy.App.ForwardAllResponses()
  },
  saveToFile: async (content) => {
    await waitForWails()
    return window.go.proxy.App.SaveToFile(content)
  },
  getBrowserRunning: async () => {
    await waitForWails()
    return window.go.proxy.App.GetBrowserRunning()
  },
  getNucleiInstalled: async () => {
    await waitForWails()
    return window.go.proxy.App.GetNucleiInstalled()
  },
  runNuclei: async (opts) => {
    await waitForWails()
    return window.go.proxy.App.RunNuclei(opts)
  },
  stopNuclei: async () => {
    await waitForWails()
    return window.go.proxy.App.StopNuclei()
  },
})

export const backend = isMock ? mockBackend : makeRealBackend()

// WebSocket for real-time events from the proxy.
// onConnect / onDisconnect fire on state changes.
// Returns a disconnect function that permanently stops reconnecting.
export function connectWS(onMessage, onConnect, onDisconnect) {
  if (isMock) return () => {}

  let stopped = false
  let ws

  function open() {
    ws = new WebSocket('ws://localhost:8081/ws')
    ws.onopen = () => { if (onConnect) onConnect() }
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)) } catch {}
    }
    ws.onerror = () => {}
    ws.onclose = () => {
      if (onDisconnect) onDisconnect()
      if (!stopped) setTimeout(open, 2000)
    }
  }

  open()
  return () => { stopped = true; ws?.close() }
}
