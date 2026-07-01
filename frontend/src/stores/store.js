import { create } from 'zustand'

export const useStore = create((set, get) => ({
  // --- Tab ---
  activeTab: 'proxy',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // --- History ---
  history: [],
  selectedEntry: null,
  historySearch: '',
  addHistoryEntry: (entry) => set((s) => {
    if (s.history.some(e => e.id === entry.id)) return s
    return { history: [entry, ...s.history].slice(0, 2000) }
  }),
  setSelectedEntry: (entry) => set({ selectedEntry: entry }),
  setHistorySearch: (q) => set({ historySearch: q }),
  clearHistory: () => set({ history: [], selectedEntry: null }),

  // --- WebSocket connection status ---
  wsConnected: false,

  // --- Intercept ---
  interceptOn: false,
  interceptQueue: [],
  setInterceptOn: (v) => set({ interceptOn: v }),
  enqueueIntercept: (r) => set((s) => ({ interceptQueue: [...s.interceptQueue, r] })),
  dequeueIntercept: () => set((s) => ({ interceptQueue: s.interceptQueue.slice(1) })),
  clearInterceptQueue: () => set({ interceptQueue: [] }),

  // --- Response intercept ---
  interceptRespOn: false,
  interceptRespQueue: [],
  setInterceptRespOn: (v) => set({ interceptRespOn: v }),
  enqueueInterceptResp: (r) => set((s) => ({ interceptRespQueue: [...s.interceptRespQueue, r] })),
  dequeueInterceptResp: () => set((s) => ({ interceptRespQueue: s.interceptRespQueue.slice(1) })),
  clearInterceptRespQueue: () => set({ interceptRespQueue: [] }),

  // --- Scope ---
  scope: [],
  addScope: (pattern) => set((s) => ({ scope: [...s.scope, pattern] })),
  removeScope: (pattern) => set((s) => ({ scope: s.scope.filter(p => p !== pattern) })),

  // --- Repeater (multi-tab) ---
  repeaterTabs: [
    { id: 'r1', name: 'Repeater 1', request: '', response: null, host: '', https: true },
  ],
  activeRepeaterTab: 'r1',
  repeaterCounter: 1,

  setActiveRepeaterTab: (id) => set({ activeRepeaterTab: id }),

  addRepeaterTab: (init = {}) => set((s) => {
    const n = s.repeaterCounter + 1
    const id = `r${n}`
    return {
      repeaterCounter: n,
      activeRepeaterTab: id,
      repeaterTabs: [...s.repeaterTabs, {
        id,
        name: `Repeater ${n}`,
        request: init.request || '',
        response: null,
        host: init.host || '',
        https: init.https ?? true,
      }],
    }
  }),

  closeRepeaterTab: (id) => set((s) => {
    const tabs = s.repeaterTabs.filter(t => t.id !== id)
    if (tabs.length === 0) {
      return {
        repeaterTabs: [{ id: 'r1', name: 'Repeater 1', request: '', response: null, host: '', https: true }],
        activeRepeaterTab: 'r1',
        repeaterCounter: 1,
      }
    }
    const active = s.activeRepeaterTab === id ? tabs[tabs.length - 1].id : s.activeRepeaterTab
    return { repeaterTabs: tabs, activeRepeaterTab: active }
  }),

  updateRepeaterTab: (id, patch) => set((s) => ({
    repeaterTabs: s.repeaterTabs.map(t => t.id === id ? { ...t, ...patch } : t),
  })),

  // --- Match & Replace rules ---
  rules: [],
  setRules: (rules) => set({ rules }),
  addRule: (preset) => set((s) => ({
    rules: [...s.rules, {
      id: `rule_${Date.now()}`,
      enabled: true,
      name: 'New rule',
      comment: '',
      target: 'request_header',
      action: 'replace',
      match: '',
      replace: '',
      isRegex: false,
      caseSensitive: false,
      urlScope: '',
      ...(preset || {}),
    }],
  })),
  updateRule: (id, patch) => set((s) => ({
    rules: s.rules.map(r => r.id === id ? { ...r, ...patch } : r),
  })),
  removeRule: (id) => set((s) => ({ rules: s.rules.filter(r => r.id !== id) })),

  // --- Intruder ---
  intruderRequest: '',
  intruderHost: '',
  intruderHttps: true,
  intruderMode: 'sniper',
  intruderPayloadLines: [],
  intruderGrep: '',
  intruderConcurrency: 10,
  intruderDelay: 0,
  intruderResults: [],
  intruderRunning: false,
  intruderTransforms: [],
  setIntruderRequest: (v) => set({ intruderRequest: v }),
  setIntruderHost: (v) => set({ intruderHost: v }),
  setIntruderHttps: (v) => set({ intruderHttps: v }),
  setIntruderMode: (v) => set({ intruderMode: v }),
  setIntruderPayloadLines: (v) => set({ intruderPayloadLines: v }),
  setIntruderGrep: (v) => set({ intruderGrep: v }),
  setIntruderConcurrency: (v) => set({ intruderConcurrency: v }),
  setIntruderDelay: (v) => set({ intruderDelay: v }),
  addIntruderResult: (r) => set((s) => ({ intruderResults: [...s.intruderResults, r] })),
  clearIntruderResults: () => set({ intruderResults: [] }),
  setIntruderRunning: (v) => set({ intruderRunning: v }),
  addIntruderTransform: (t) => set((s) => ({ intruderTransforms: [...s.intruderTransforms, t] })),
  removeIntruderTransform: (idx) => set((s) => ({ intruderTransforms: s.intruderTransforms.filter((_, i) => i !== idx) })),
  updateIntruderTransform: (idx, patch) => set((s) => ({
    intruderTransforms: s.intruderTransforms.map((t, i) => i === idx ? { ...t, ...patch } : t),
  })),

  // --- Crawler ---
  crawlNodes: [],
  crawlRunning: false,
  addCrawlNode: (n) => set((s) => ({ crawlNodes: [...s.crawlNodes, n] })),
  clearCrawlNodesStore: (nodes) => set({ crawlNodes: nodes || [] }),
  setCrawlRunning: (v) => set({ crawlRunning: v }),

  // --- Active token (updated live via WS token_update events) ---
  activeToken: '',
  setActiveToken: (v) => set({ activeToken: v }),

  // --- SQLMap ---
  sqlmapRequest: '',
  sqlmapRunning: false,
  sqlmapOutput: [],
  setSQLMapRequest: (v) => set({ sqlmapRequest: v }),
  setSQLMapRunning: (v) => set({ sqlmapRunning: v }),
  addSQLMapOutput: (line) => set((s) => ({ sqlmapOutput: [...s.sqlmapOutput, line] })),
  clearSQLMapOutput: () => set({ sqlmapOutput: [] }),

  // Send history entry to a NEW repeater tab
  sendToRepeater: (entry) => {
    const s = get()
    s.addRepeaterTab({
      request: entry.requestHeaders || '',
      host: entry.host,
      https: entry.url?.startsWith('https') ?? true,
    })
    set({ activeTab: 'repeater' })
  },

  // Send history entry to intruder
  sendToIntruder: (entry) => {
    set({
      activeTab: 'intruder',
      intruderRequest: entry.requestHeaders || '',
      intruderHost: entry.host,
      intruderHttps: entry.url?.startsWith('https') ?? true,
      intruderPayloadLines: [],
    })
  },

  // Send history entry to SQLMap
  sendToSQLMap: (entry) => {
    set({
      activeTab: 'sqlmap',
      sqlmapRequest: entry.requestHeaders || '',
    })
  },

  // --- Nuclei ---
  nucleiRunning: false,
  nucleiOutput: [],
  nucleiTarget: '',
  nucleiTags: '',
  setNucleiRunning: (v) => set({ nucleiRunning: v }),
  addNucleiOutput: (line) => set((s) => ({ nucleiOutput: [...s.nucleiOutput, line] })),
  clearNucleiOutput: () => set({ nucleiOutput: [] }),
  setNucleiTarget: (v) => set({ nucleiTarget: v }),
  setNucleiTags: (v) => set({ nucleiTags: v }),
}))
