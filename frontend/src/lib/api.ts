const API_KEY = "qs_prod_af4cc2d147805a2ada0f69c3383f0874";

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  "X-API-KEY": API_KEY,
};

async function fetchJSON(url: string, opts?: RequestInit) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...headers, ...(opts?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

/**
 * Normalize position from backend format.
 */
function normalizePosition(p: any) {
  return {
    ...p,
    symbol: p.tokenSymbol,
    positionSize: p.positionSizeUsd,
    unrealizedPnl: p.pnlUsd,
    unrealizedPnlPercent: p.pnlPercent,
    realizedPnl: p.pnlUsd,
    realizedPnlPercent: p.pnlPercent,
    pnl: p.pnlUsd,
    stopLoss: p.stopLossPrice,
    takeProfit1: p.tp1Price,
    entryTime: p.openedAt,
    exitTime: p.closedAt,
    breakEvenMoved: p.tp1Hit && parseFloat(p.pnlPercent ?? "0") > 0,
  };
}

/**
 * Normalize scan log entry.
 */
function normalizeScan(s: any) {
  return {
    ...s,
    scanTime: s.scannedAt ?? s.scanTime,
    durationMs: s.scanDurationMs,
    qualifiedTokens: s.qualifiedTokens ?? null,
  };
}

/**
 * Normalize a learning pattern from backend format.
 * Backend fields: patternType, patternValue, totalTrades, wins, losses, avgPnlPercent, totalPnlUsd, weightAdjustment
 * Frontend expects: category, patternKey, winTrades, lossTrades, scoreAdjustment
 */
function normalizePattern(p: any) {
  return {
    ...p,
    category: p.patternType ?? p.category,
    patternKey: p.patternValue ?? p.patternKey,
    winTrades: p.wins ?? p.winTrades ?? 0,
    lossTrades: p.losses ?? p.lossTrades ?? 0,
    scoreAdjustment: parseFloat(p.weightAdjustment ?? p.scoreAdjustment ?? "0"),
    avgPnlPercent: p.avgPnlPercent ?? "0",
    totalPnlUsd: p.totalPnlUsd ?? "0",
  };
}

export const api = {
  // Health (simple)
  getHealth: () => fetchJSON("/api/health"),

  // Engine state — now also fetches history + positions to compute real stats
  getEngine: async () => {
    const [raw, posRaw, histRaw] = await Promise.all([
      fetchJSON("/api/engine"),
      fetchJSON("/api/positions"),
      fetchJSON("/api/history?limit=200"),
    ]);

    const s = raw.state || {};
    const positions = (posRaw.positions ?? []).map(normalizePosition);
    const closedTrades = (histRaw.trades ?? []).map(normalizePosition);

    // Compute real stats from closed trades
    const wins = closedTrades.filter((t: any) => parseFloat(t.pnlPercent ?? "0") >= 0).length;
    const losses = closedTrades.filter((t: any) => parseFloat(t.pnlPercent ?? "0") < 0).length;
    const realizedPnl = closedTrades.reduce((sum: number, t: any) => sum + parseFloat(t.pnlUsd ?? "0"), 0);

    // Compute unrealized P&L from open positions
    const unrealizedPnl = positions.reduce((sum: number, p: any) => sum + parseFloat(p.pnlUsd ?? "0"), 0);

    // Total P&L = realized + unrealized
    const totalPnl = realizedPnl + unrealizedPnl;
    const equity = 1000 + totalPnl;
    const peakEquity = Math.max(equity, parseFloat(s.peakEquity ?? "1000"));
    const drawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;

    // Daily P&L from engine state (backend tracks this)
    const dailyPnl = parseFloat(s.dailyPnlUsd ?? "0") + unrealizedPnl;

    return {
      isRunning: raw.running ?? false,
      status: s.status ?? "stopped",
      engine: s.status ?? "stopped",

      liveEquity: equity.toFixed(2),
      currentBalance: equity.toFixed(2),
      totalPnl: totalPnl.toFixed(2),
      totalPnlPercent: ((totalPnl / 1000) * 100).toFixed(2),
      dailyPnl: dailyPnl.toFixed(2),
      liveDailyPnl: dailyPnl.toFixed(2),
      liveDailyPnlPercent: equity > 0 ? ((dailyPnl / equity) * 100).toFixed(2) : "0",
      drawdownPercent: drawdown.toFixed(2),

      totalWins: wins,
      totalLosses: losses,
      totalTrades: closedTrades.length,
      consecutiveLosses: s.consecutiveLosses ?? 0,

      totalUnrealizedPnl: unrealizedPnl.toFixed(2),
      totalRealizedPnl: realizedPnl.toFixed(2),

      lastScanTokensScanned: s.lastScanTokensScanned ?? 0,
      lastScanTokensQualified: s.lastScanTokensQualified ?? 0,
      lastScanTopCandidate: s.lastScanTopCandidate ?? null,
      lastScanTopScore: s.lastScanTopScore ?? 0,
      totalScans: s.totalScans ?? 0,

      params: raw.params ?? {},
    };
  },

  startEngine: () => fetchJSON("/api/engine/start", { method: "POST" }),
  stopEngine: () => fetchJSON("/api/engine/stop", { method: "POST" }),

  // Positions (normalized)
  getPositions: async () => {
    const raw = await fetchJSON("/api/positions");
    const positions = (raw.positions ?? []).map(normalizePosition);
    return { positions, count: raw.count ?? positions.length };
  },

  // History (normalized) - endpoint is /api/history
  getHistory: async (limit = 50) => {
    const raw = await fetchJSON(`/api/history?limit=${limit}`);
    const trades = (raw.trades ?? []).map(normalizePosition);
    return { trades, count: raw.count ?? trades.length };
  },

  // Scans (normalized) - response uses `logs` key
  getScans: async (limit = 20) => {
    const raw = await fetchJSON(`/api/scans?limit=${limit}`);
    const scans = (raw.logs ?? []).map(normalizeScan);
    return { scans, count: raw.count ?? scans.length };
  },

  // Health metrics (normalized)
  getHealthMetrics: async () => {
    const raw = await fetchJSON("/api/health/metrics");
    const h = raw.health || {};
    const upSince = h.upSince ? new Date(h.upSince).getTime() : 0;
    const uptimeMs = upSince ? Date.now() - upSince : 0;
    return {
      grade: h.grade ?? "UNKNOWN",
      totalCycles: h.totalCycles ?? 0,
      successRate: (h.successRate ?? 0) * 100,
      avgCycleDurationMs: h.avgCycleMs ?? 0,
      avgCycleMs: h.avgCycleMs ?? 0,
      maxCycleDurationMs: h.maxCycleMs ?? 0,
      lastCycleDurationMs: h.lastCycleMs ?? 0,
      apiErrorRate: (h.apiErrorRate ?? 0) * 100,
      apiTotalCalls: h.apiTotalCalls ?? 0,
      apiAvgLatencyMs: h.apiAvgLatencyMs ?? 0,
      consecutiveFailures: h.consecutiveFailures ?? 0,
      uptime: uptimeMs,
      uptimeMs: uptimeMs,
      memoryUsageMb: h.memoryUsageMb ?? 0,
      cyclesPerMinute: h.totalCycles && uptimeMs > 0
        ? ((h.totalCycles / uptimeMs) * 60000).toFixed(1)
        : "0",
      autoRestarts: h.autoRestarts ?? 0,
      failedCycles: h.failedCycles ?? 0,
      overlappingCyclesPrevented: h.overlappingCyclesPrevented ?? 0,
      recentCycles: raw.recentCycles ?? [],
      recentErrors: raw.recentErrors ?? [],
    };
  },

  // Parameters
  getParams: async () => {
    const raw = await fetchJSON("/api/params");
    return { params: raw.params ?? raw };
  },

  // Learning patterns (normalized)
  getPatterns: async () => {
    const raw = await fetchJSON("/api/patterns");
    const patterns = (raw.patterns ?? []).map(normalizePattern);
    return { patterns, count: raw.count ?? patterns.length };
  },

  // Auto-Tuner
  getAutoTunerStatus: () => fetchJSON("/api/autotuner/status"),
  getAutoTuneHistory: (limit = 20) => fetchJSON(`/api/autotuner/history?limit=${limit}`),
  runAutoTune: () => fetchJSON("/api/autotuner/run", { method: "POST" }),
  revertToBaseline: () => fetchJSON("/api/autotuner/revert", { method: "POST" }),
  getABComparison: () => fetchJSON("/api/autotuner/comparison"),
  getAutoTunerWeights: () => fetchJSON("/api/autotuner/weights"),
};
