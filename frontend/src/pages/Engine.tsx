import { useState, useCallback } from "react";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { Toaster, toast } from "sonner";

// ─── STATUS BADGE ───────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    paused: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    stopped: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    loss_pause: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    daily_halt: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  };
  const labels: Record<string, string> = {
    running: "RUNNING",
    paused: "PAUSED",
    stopped: "STOPPED",
    loss_pause: "LOSS PAUSE",
    daily_halt: "DAILY HALT",
  };
  return (
    <span
      className={`px-3 py-1 rounded text-xs font-mono font-bold border ${colors[status] || colors.stopped}`}
    >
      {labels[status] || status?.toUpperCase() || "UNKNOWN"}
    </span>
  );
}

// ─── POSITION CARD ──────────────────────────────────────────

function PositionCard({ pos }: { pos: any }) {
  const pnl = pos.status === "open"
    ? parseFloat(pos.unrealizedPnl ?? pos.pnl ?? "0")
    : parseFloat(pos.realizedPnl ?? pos.pnl ?? "0");
  const pnlPct = pos.status === "open"
    ? parseFloat(pos.unrealizedPnlPercent ?? pos.pnlPercent ?? "0")
    : parseFloat(pos.realizedPnlPercent ?? pos.pnlPercent ?? "0");
  const isProfit = pnl >= 0;
  const isOpen = pos.status === "open";

  const statusColors: Record<string, string> = {
    open: "border-l-sky-500",
    closed: "border-l-zinc-500",
    stopped_out: "border-l-rose-500",
    tp_hit: "border-l-emerald-500",
  };

  return (
    <div
      className={`bg-zinc-900/50 border border-zinc-800 border-l-4 ${statusColors[pos.status] || "border-l-zinc-500"} rounded-lg p-4`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-white text-lg">
            {pos.tokenSymbol ?? pos.symbol}
          </span>
          <span className="text-xs text-zinc-500 font-mono">
            {pos.chain}
          </span>
          {pos.dex && (
            <span className="text-xs text-zinc-600 font-mono">
              {pos.dex}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pos.tp1Hit && (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              TP1
            </span>
          )}
          {pos.breakEvenMoved && (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/20 text-sky-400 border border-sky-500/30">
              BE
            </span>
          )}
          <span
            className={`font-mono font-bold text-lg ${isProfit ? "text-emerald-400" : "text-rose-400"}`}
          >
            {isProfit ? "+" : ""}
            {pnlPct.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <span className="text-zinc-500 block">ENTRY</span>
          <span className="text-white font-mono">
            ${parseFloat(pos.entryPrice ?? "0").toFixed(8)}
          </span>
        </div>
        <div>
          <span className="text-zinc-500 block">
            {isOpen ? "CURRENT" : "EXIT"}
          </span>
          <span className="text-white font-mono">
            ${parseFloat(pos.currentPrice ?? pos.entryPrice ?? "0").toFixed(8)}
          </span>
        </div>
        <div>
          <span className="text-zinc-500 block">SIZE</span>
          <span className="text-white font-mono">
            ${parseFloat(pos.positionSize ?? "0").toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-zinc-500 block">P&L</span>
          <span
            className={`font-mono font-bold ${isProfit ? "text-emerald-400" : "text-rose-400"}`}
          >
            {isProfit ? "+" : ""}${pnl.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mt-2">
        <div>
          <span className="text-zinc-500 block">STOP LOSS</span>
          <span className="text-rose-400 font-mono">
            ${parseFloat(pos.stopLoss ?? "0").toFixed(8)}
          </span>
        </div>
        <div>
          <span className="text-zinc-500 block">TP1</span>
          <span className="text-emerald-400 font-mono">
            ${parseFloat(pos.takeProfit1 ?? "0").toFixed(8)}
          </span>
        </div>
        <div>
          <span className="text-zinc-500 block">SCORE</span>
          <span className="text-sky-400 font-mono">
            {pos.convictionScore ?? 0}/100
          </span>
        </div>
        <div>
          <span className="text-zinc-500 block">
            {isOpen ? "OPENED" : "CLOSED"}
          </span>
          <span className="text-zinc-400 font-mono">
            {new Date(
              isOpen ? pos.entryTime : pos.exitTime ?? pos.entryTime
            ).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {(pos.entryReason || pos.exitReason) && (
        <div className="mt-3 text-xs">
          {pos.entryReason && (
            <div className="text-zinc-500">
              <span className="text-zinc-600">ENTRY: </span>
              {pos.entryReason}
            </div>
          )}
          {pos.exitReason && (
            <div className="text-zinc-500 mt-1">
              <span className="text-zinc-600">EXIT: </span>
              {pos.exitReason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SCAN LOG ENTRY ─────────────────────────────────────────

function ScanLogEntry({ log }: { log: any }) {
  const hasErrors = !!log.errors;
  const qualified = log.qualifiedTokens as
    | { symbol: string; score: number; chain: string }[]
    | null;

  return (
    <div className="flex items-start gap-3 py-2 border-b border-zinc-800/50 last:border-0">
      <div
        className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
          hasErrors
            ? "bg-amber-500"
            : log.tradesExecuted > 0
              ? "bg-emerald-500"
              : "bg-zinc-600"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-400 font-mono">
            {new Date(log.scanTime).toLocaleTimeString()}
          </span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-500">
            {log.tokensScanned} scanned
          </span>
          <span className="text-zinc-600">|</span>
          <span
            className={
              log.tokensQualified > 0
                ? "text-emerald-400"
                : "text-zinc-500"
            }
          >
            {log.tokensQualified} qualified
          </span>
          {log.tradesExecuted > 0 && (
            <>
              <span className="text-zinc-600">|</span>
              <span className="text-sky-400 font-bold">
                {log.tradesExecuted} traded
              </span>
            </>
          )}
          {log.durationMs && (
            <>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-600">{log.durationMs}ms</span>
            </>
          )}
        </div>
        {qualified && qualified.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {qualified.map((t: any, i: number) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              >
                {t.symbol} ({t.score})
              </span>
            ))}
          </div>
        )}
        {hasErrors && (
          <div className="text-[10px] text-amber-400/70 mt-1 truncate">
            {log.errors}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LEARNING PANEL ──────────────────────────────────────────

function LearningPanel() {
  const patternsFetcher = useCallback(() => api.getPatterns(), []);
  const { data: patternsData } = usePolling(patternsFetcher, 30000);

  const patterns = patternsData?.patterns ?? patternsData ?? [];

  // Group patterns by category
  const grouped = (Array.isArray(patterns) ? patterns : []).reduce(
    (acc: any, p: any) => {
      const cat = p.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(p);
      return acc;
    },
    {} as Record<string, any[]>
  );

  const categoryLabels: Record<string, string> = {
    chain: "Blockchain",
    dex: "DEX",
    conviction_range: "Conviction Score",
    exit_type: "Exit Type",
    hold_time: "Hold Duration",
    liquidity_range: "Liquidity Range",
    time_of_day: "Time of Day",
  };

  if (!Array.isArray(patterns) || patterns.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
        <div className="text-4xl mb-3">&#129504;</div>
        <div className="text-zinc-400 font-mono text-sm font-bold mb-2">
          LEARNING SYSTEM ACTIVE
        </div>
        <div className="text-zinc-500 text-xs max-w-md mx-auto">
          The engine learns from every closed trade. It tracks patterns across
          chains, DEXes, conviction scores, hold times, liquidity ranges, and
          time of day. After 3+ trades per pattern, it automatically adjusts
          scoring to favor winning setups and avoid losing ones.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([category, categoryPatterns]: [string, any[]]) => (
        <div
          key={category}
          className="bg-zinc-900/50 border border-zinc-800 rounded-lg"
        >
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-mono font-bold text-zinc-300">
              {categoryLabels[category] || category.toUpperCase()}
            </h3>
          </div>
          <div className="p-3 space-y-2">
            {categoryPatterns
              .sort((a: any, b: any) => b.totalTrades - a.totalTrades)
              .map((p: any, idx: number) => {
                const winRate =
                  p.totalTrades > 0
                    ? (p.winTrades / p.totalTrades) * 100
                    : 0;
                const avgPnl = parseFloat(p.avgPnlPercent ?? "0");
                const adj = p.scoreAdjustment ?? 0;

                return (
                  <div
                    key={p.id ?? idx}
                    className="flex items-center justify-between py-1.5 border-b border-zinc-800/50 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          adj > 0
                            ? "bg-emerald-500"
                            : adj < 0
                              ? "bg-rose-500"
                              : "bg-zinc-600"
                        }`}
                      />
                      <span className="text-sm font-mono text-zinc-300">
                        {p.patternKey}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="text-zinc-500">
                        {p.totalTrades} trades
                      </span>
                      <span
                        className={
                          winRate >= 50
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }
                      >
                        {winRate.toFixed(0)}% WR
                      </span>
                      <span
                        className={
                          avgPnl >= 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }
                      >
                        {avgPnl >= 0 ? "+" : ""}
                        {avgPnl.toFixed(1)}%
                      </span>
                      {adj !== 0 && p.totalTrades >= 3 && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            adj > 0
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          {adj > 0 ? "+" : ""}
                          {adj} score
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── HEALTH MONITORING PANEL ────────────────────────────────

function HealthPanel() {
  const healthFetcher = useCallback(() => api.getHealthMetrics(), []);
  const { data: health } = usePolling(healthFetcher, 10000);

  if (!health) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
        <div className="text-zinc-600 text-4xl mb-3">&#128260;</div>
        <div className="text-zinc-500 font-mono text-sm">
          Loading health data...
        </div>
      </div>
    );
  }

  const uptimeMs = health.uptime ?? health.uptimeMs ?? 0;
  const uptimeDisplay =
    uptimeMs > 86400000
      ? `${(uptimeMs / 86400000).toFixed(1)}d`
      : uptimeMs > 3600000
        ? `${(uptimeMs / 3600000).toFixed(1)}h`
        : `${Math.round(uptimeMs / 60000)}m`;

  const successRate = health.successRate ?? 100;
  const apiErrorRate = health.apiErrorRate ?? 0;
  const consecutiveFailures = health.consecutiveFailures ?? 0;

  let healthGrade = "EXCELLENT";
  let healthColor = "text-emerald-400";
  let healthBg = "bg-emerald-500/10 border-emerald-500/20";
  if (successRate < 95 || apiErrorRate > 10) {
    healthGrade = "GOOD";
    healthColor = "text-sky-400";
    healthBg = "bg-sky-500/10 border-sky-500/20";
  }
  if (successRate < 80 || apiErrorRate > 25 || consecutiveFailures > 2) {
    healthGrade = "DEGRADED";
    healthColor = "text-amber-400";
    healthBg = "bg-amber-500/10 border-amber-500/20";
  }
  if (successRate < 50 || consecutiveFailures > 4) {
    healthGrade = "CRITICAL";
    healthColor = "text-rose-400";
    healthBg = "bg-rose-500/10 border-rose-500/20";
  }

  return (
    <div className="space-y-4">
      {/* Overall Health Grade */}
      <div className={`border rounded-lg p-4 ${healthBg}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-zinc-500 font-mono mb-1">SYSTEM HEALTH</div>
            <div className={`text-2xl font-mono font-bold ${healthColor}`}>
              {healthGrade}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-zinc-500 font-mono">UPTIME</div>
            <div className="text-lg font-mono text-zinc-300">{uptimeDisplay}</div>
          </div>
        </div>
      </div>

      {/* Health Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <HealthMetric
          label="CYCLES"
          value={(health.totalCycles ?? 0).toString()}
          sub={`${successRate.toFixed(1)}% success`}
          color={successRate >= 90 ? "text-emerald-400" : successRate >= 70 ? "text-amber-400" : "text-rose-400"}
        />
        <HealthMetric
          label="AVG CYCLE"
          value={`${((health.avgCycleDurationMs ?? 0) / 1000).toFixed(1)}s`}
          sub={`max ${((health.maxCycleDurationMs ?? 0) / 1000).toFixed(1)}s`}
          color={(health.avgCycleDurationMs ?? 0) < 10000 ? "text-emerald-400" : (health.avgCycleDurationMs ?? 0) < 30000 ? "text-amber-400" : "text-rose-400"}
        />
        <HealthMetric
          label="API CALLS"
          value={(health.apiTotalCalls ?? 0).toString()}
          sub={`${apiErrorRate.toFixed(1)}% errors`}
          color={apiErrorRate < 5 ? "text-emerald-400" : apiErrorRate < 15 ? "text-amber-400" : "text-rose-400"}
        />
        <HealthMetric
          label="MEMORY"
          value={`${health.memoryUsageMb ?? 0}MB`}
          color="text-zinc-300"
        />
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-xs font-mono text-zinc-500 mb-3">PERFORMANCE</h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-400">Cycles/min</span>
              <span className="text-zinc-300 font-mono">{health.cyclesPerMinute ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Last cycle</span>
              <span className="text-zinc-300 font-mono">{((health.lastCycleDurationMs ?? 0) / 1000).toFixed(1)}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">API avg latency</span>
              <span className="text-zinc-300 font-mono">{health.apiAvgLatencyMs ?? 0}ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Memory</span>
              <span className="text-zinc-300 font-mono">{health.memoryUsageMb ?? 0}MB</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-xs font-mono text-zinc-500 mb-3">SELF-HEALING</h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-400">Auto-restarts</span>
              <span className={`font-mono ${(health.autoRestarts ?? 0) > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {health.autoRestarts ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Consec. failures</span>
              <span className={`font-mono ${consecutiveFailures > 2 ? "text-rose-400" : "text-emerald-400"}`}>
                {consecutiveFailures}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Overlaps prevented</span>
              <span className="text-zinc-300 font-mono">{health.overlappingCyclesPrevented ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Failed cycles</span>
              <span className={`font-mono ${(health.failedCycles ?? 0) > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {health.failedCycles ?? 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Errors */}
      {health.recentErrors && health.recentErrors.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-xs font-mono text-zinc-500 mb-3">
            RECENT ERRORS ({health.recentErrors.length})
          </h4>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {health.recentErrors
              .slice()
              .reverse()
              .map((err: any, i: number) => (
                <div
                  key={i}
                  className="text-[10px] py-1 border-b border-zinc-800/50 last:border-0"
                >
                  <span className="text-zinc-600 font-mono">
                    {new Date(err.time).toLocaleTimeString()}
                  </span>
                  <span className="text-zinc-700 mx-1">|</span>
                  <span className="text-amber-400/60">[{err.source}]</span>
                  <span className="text-zinc-700 mx-1">|</span>
                  <span className="text-rose-400/70">{err.message}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HealthMetric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
      <div className="text-[10px] text-zinc-500 font-mono mb-1">{label}</div>
      <div className={`text-lg font-mono font-bold ${color}`}>{value}</div>
      {sub && (
        <div className={`text-xs font-mono ${color} opacity-70`}>{sub}</div>
      )}
    </div>
  );
}

// ─── AUTO-TUNER PANEL ───────────────────────────────────────

function AutoTunerPanel() {
  const [isRunning, setIsRunning] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  const [activeView, setActiveView] = useState<"status" | "comparison" | "history">("status");

  const statusFetcher = useCallback(() => api.getAutoTunerStatus(), []);
  const historyFetcher = useCallback(() => api.getAutoTuneHistory(20), []);
  const comparisonFetcher = useCallback(() => api.getABComparison(), []);

  const { data: status, refetch: refetchStatus } = usePolling(statusFetcher, 30000);
  const { data: historyData, refetch: refetchHistory } = usePolling(historyFetcher, 30000);
  const { data: comparison, refetch: refetchComparison } = usePolling(comparisonFetcher, 30000);

  const runs = historyData?.runs ?? [];

  async function handleRunAutoTune() {
    setIsRunning(true);
    try {
      const result = await api.runAutoTune();
      toast.success(`Auto-tune complete: ${result.run?.adjustmentsMade ?? 0} adjustments made`);
      refetchStatus();
      refetchHistory();
      refetchComparison();
    } catch (err: any) {
      toast.error(`Auto-tune failed: ${err.message}`);
    }
    setIsRunning(false);
  }

  async function handleRevert() {
    setIsReverting(true);
    try {
      await api.revertToBaseline();
      toast.success("Weights reverted to baseline defaults");
      setShowRevertConfirm(false);
      refetchStatus();
      refetchHistory();
      refetchComparison();
    } catch (err: any) {
      toast.error(`Revert failed: ${err.message}`);
    }
    setIsReverting(false);
  }

  const drift = status?.totalWeightDrift ?? 0;
  const hasDrift = drift > 0;

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs text-zinc-500 font-mono mb-1">OUTCOME AUTO-TUNER</div>
            <div className="flex items-center gap-3">
              <span className={`text-lg font-mono font-bold ${status?.enabled ? "text-emerald-400" : "text-zinc-400"}`}>
                {status?.enabled ? "ACTIVE" : "INACTIVE"}
              </span>
              {hasDrift && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  DRIFT: {drift.toFixed(1)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunAutoTune}
              disabled={isRunning}
              className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-mono text-xs font-bold disabled:opacity-50 transition-colors"
            >
              {isRunning ? "RUNNING..." : "RUN NOW"}
            </button>
            {hasDrift && (
              <button
                onClick={() => setShowRevertConfirm(true)}
                className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-white font-mono text-xs font-bold transition-colors"
              >
                REVERT
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-zinc-500 block">TOTAL RUNS</span>
            <span className="text-white font-mono">{status?.totalRuns ?? 0}</span>
          </div>
          <div>
            <span className="text-zinc-500 block">LAST RUN</span>
            <span className="text-white font-mono">
              {status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : "Never"}
            </span>
          </div>
          <div>
            <span className="text-zinc-500 block">NEXT RUN</span>
            <span className="text-white font-mono">{status?.nextRunIn ?? "—"}</span>
          </div>
          <div>
            <span className="text-zinc-500 block">WEIGHT DRIFT</span>
            <span className={`font-mono ${hasDrift ? "text-amber-400" : "text-zinc-400"}`}>
              {drift.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Revert Confirmation */}
      {showRevertConfirm && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-rose-400 font-mono text-sm font-bold">Revert to Baseline?</div>
              <div className="text-zinc-400 text-xs mt-1">
                This will reset all auto-tuned scoring weights back to their original defaults.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRevertConfirm(false)}
                className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-white font-mono text-xs font-bold transition-colors"
              >
                CANCEL
              </button>
              <button
                onClick={handleRevert}
                disabled={isReverting}
                className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-bold disabled:opacity-50 transition-colors"
              >
                {isReverting ? "REVERTING..." : "CONFIRM REVERT"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 bg-zinc-900/50 border border-zinc-800 rounded-lg p-1">
        {(["status", "comparison", "history"] as const).map((view) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={`flex-1 px-3 py-1.5 rounded text-xs font-mono font-bold transition-colors ${
              activeView === view
                ? "bg-amber-600/80 text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            {view === "status" ? "WEIGHTS" : view === "comparison" ? "A/B COMPARE" : "HISTORY"}
          </button>
        ))}
      </div>

      {/* Sub-tab Content */}
      {activeView === "status" ? (
        <WeightsView weights={status?.currentWeights} baseline={status?.baselineWeights} />
      ) : activeView === "comparison" ? (
        <ComparisonView comparison={comparison} />
      ) : (
        <HistoryView runs={runs} />
      )}
    </div>
  );
}

function WeightsView({ weights, baseline }: { weights: any; baseline: any }) {
  if (!weights) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
        <div className="text-zinc-500 font-mono text-sm">Loading weights...</div>
      </div>
    );
  }

  const factors = Object.keys(weights);
  const maxWeight = Math.max(...factors.map((f) => Math.max(weights[f] ?? 0, baseline?.[f] ?? 0)));

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h4 className="text-xs font-mono text-zinc-500 mb-4">SCORING FACTOR WEIGHTS</h4>
      <div className="space-y-3">
        {factors.map((factor) => {
          const current = weights[factor] ?? 0;
          const base = baseline?.[factor] ?? current;
          const diff = current - base;
          const pct = maxWeight > 0 ? (current / maxWeight) * 100 : 0;
          const basePct = maxWeight > 0 ? (base / maxWeight) * 100 : 0;

          return (
            <div key={factor}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-zinc-400 font-mono">
                  {factor.replace(/([A-Z])/g, " $1").toUpperCase()}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 font-mono">{base.toFixed(1)}</span>
                  <span className="text-zinc-600">&rarr;</span>
                  <span className={`font-mono font-bold ${
                    diff > 0 ? "text-emerald-400" : diff < 0 ? "text-rose-400" : "text-zinc-300"
                  }`}>
                    {current.toFixed(1)}
                  </span>
                  {diff !== 0 && (
                    <span className={`text-[10px] font-mono ${
                      diff > 0 ? "text-emerald-400" : "text-rose-400"
                    }`}>
                      ({diff > 0 ? "+" : ""}{diff.toFixed(1)})
                    </span>
                  )}
                </div>
              </div>
              <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-zinc-600/50 rounded-full"
                  style={{ width: `${basePct}%` }}
                />
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${
                    diff > 0 ? "bg-emerald-500/70" : diff < 0 ? "bg-rose-500/70" : "bg-amber-500/70"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ComparisonView({ comparison }: { comparison: any }) {
  if (!comparison) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
        <div className="text-zinc-500 font-mono text-sm">Loading comparison...</div>
      </div>
    );
  }

  const { baseline, tuned, dimensionChanges, recommendation, improvementPercent } = comparison;
  const isImproved = improvementPercent > 0;

  return (
    <div className="space-y-4">
      {/* Recommendation */}
      <div className={`border rounded-lg p-4 ${
        isImproved
          ? "bg-emerald-500/10 border-emerald-500/20"
          : improvementPercent < 0
            ? "bg-rose-500/10 border-rose-500/20"
            : "bg-zinc-800/50 border-zinc-700"
      }`}>
        <div className="flex items-center gap-3 mb-2">
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
            isImproved
              ? "bg-emerald-500/20 text-emerald-400"
              : improvementPercent < 0
                ? "bg-rose-500/20 text-rose-400"
                : "bg-zinc-700 text-zinc-400"
          }`}>
            {isImproved ? "IMPROVED" : improvementPercent < 0 ? "REGRESSION" : "NEUTRAL"}
          </span>
          <span className={`font-mono text-sm font-bold ${
            isImproved ? "text-emerald-400" : improvementPercent < 0 ? "text-rose-400" : "text-zinc-400"
          }`}>
            {improvementPercent >= 0 ? "+" : ""}{improvementPercent.toFixed(2)}%
          </span>
        </div>
        <div className="text-zinc-400 text-xs">{recommendation}</div>
      </div>

      {/* Side-by-side metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-xs font-mono text-zinc-500 mb-3">BASELINE</h4>
          <div className="space-y-2 text-xs">
            <MetricRow label="Win Rate" value={`${(baseline?.winRate ?? 0).toFixed(1)}%`} />
            <MetricRow label="Avg P&L" value={`${(baseline?.avgPnl ?? 0).toFixed(2)}%`} />
            <MetricRow label="Total P&L" value={`${(baseline?.totalPnl ?? 0).toFixed(2)}%`} />
            <MetricRow label="Avg Win" value={`+${(baseline?.avgWinPnl ?? 0).toFixed(2)}%`} color="text-emerald-400" />
            <MetricRow label="Avg Loss" value={`${(baseline?.avgLossPnl ?? 0).toFixed(2)}%`} color="text-rose-400" />
            <MetricRow label="Best" value={`+${(baseline?.bestTrade ?? 0).toFixed(2)}%`} color="text-emerald-400" />
            <MetricRow label="Worst" value={`${(baseline?.worstTrade ?? 0).toFixed(2)}%`} color="text-rose-400" />
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-amber-500/30 rounded-lg p-4">
          <h4 className="text-xs font-mono text-amber-400 mb-3">TUNED (CURRENT)</h4>
          <div className="space-y-2 text-xs">
            <MetricRow label="Win Rate" value={`${(tuned?.winRate ?? 0).toFixed(1)}%`} />
            <MetricRow label="Avg P&L" value={`${(tuned?.avgPnl ?? 0).toFixed(2)}%`} />
            <MetricRow label="Total P&L" value={`${(tuned?.totalPnl ?? 0).toFixed(2)}%`} />
            <MetricRow label="Avg Win" value={`+${(tuned?.avgWinPnl ?? 0).toFixed(2)}%`} color="text-emerald-400" />
            <MetricRow label="Avg Loss" value={`${(tuned?.avgLossPnl ?? 0).toFixed(2)}%`} color="text-rose-400" />
            <MetricRow label="Best" value={`+${(tuned?.bestTrade ?? 0).toFixed(2)}%`} color="text-emerald-400" />
            <MetricRow label="Worst" value={`${(tuned?.worstTrade ?? 0).toFixed(2)}%`} color="text-rose-400" />
          </div>
        </div>
      </div>

      {/* Dimension changes */}
      {dimensionChanges && dimensionChanges.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h4 className="text-xs font-mono text-zinc-500 mb-3">WEIGHT CHANGES BY DIMENSION</h4>
          <div className="space-y-2">
            {dimensionChanges.filter((d: any) => d.change !== 0).map((d: any) => (
              <div key={d.dimension} className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-mono">
                  {d.dimension.replace(/([A-Z])/g, " $1").toUpperCase()}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 font-mono">{d.baselineWeight.toFixed(1)}</span>
                  <span className="text-zinc-600">&rarr;</span>
                  <span className={`font-mono font-bold ${
                    d.change > 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {d.currentWeight.toFixed(1)}
                  </span>
                  <span className={`text-[10px] font-mono ${
                    d.change > 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    ({d.change > 0 ? "+" : ""}{d.changePercent.toFixed(0)}%)
                  </span>
                </div>
              </div>
            ))}
            {dimensionChanges.filter((d: any) => d.change !== 0).length === 0 && (
              <div className="text-zinc-500 text-xs text-center py-2">No weight changes yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-400">{label}</span>
      <span className={`font-mono ${color ?? "text-zinc-300"}`}>{value}</span>
    </div>
  );
}

function HistoryView({ runs }: { runs: any[] }) {
  if (!runs || runs.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
        <div className="text-4xl mb-3">&#9881;</div>
        <div className="text-zinc-400 font-mono text-sm font-bold mb-2">NO AUTO-TUNE RUNS YET</div>
        <div className="text-zinc-500 text-xs max-w-md mx-auto">
          The auto-tuner analyzes closed trade outcomes every 4 hours and adjusts
          scoring weights to favor factors that predict winning trades. Click "RUN NOW"
          to trigger a manual analysis.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((run: any, i: number) => {
        const isRevert = run.runType === "revert";
        const borderColor = isRevert
          ? "border-l-rose-500"
          : run.adjustmentsMade > 0
            ? "border-l-amber-500"
            : "border-l-zinc-600";

        return (
          <div
            key={run.id ?? i}
            className={`bg-zinc-900/50 border border-zinc-800 border-l-4 ${borderColor} rounded-lg p-4`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  isRevert
                    ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                    : run.runType === "scheduled"
                      ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                      : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                }`}>
                  {isRevert ? "REVERT" : run.runType?.toUpperCase() ?? "MANUAL"}
                </span>
                <span className="text-zinc-500 text-xs font-mono">
                  {run.runAt ? new Date(run.runAt).toLocaleString() : "—"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {!isRevert && (
                  <>
                    <span className="text-zinc-400">
                      {run.outcomeCount} trades
                    </span>
                    <span className={`font-mono ${
                      (run.winRate ?? 0) >= 50 ? "text-emerald-400" : "text-rose-400"
                    }`}>
                      {(run.winRate ?? 0).toFixed(1)}% WR
                    </span>
                  </>
                )}
                <span className="text-amber-400 font-mono font-bold">
                  {run.adjustmentsMade ?? 0} adj
                </span>
              </div>
            </div>
            <div className="text-zinc-500 text-xs">{run.analysisSummary}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MAIN ENGINE PAGE ─────────────────────────────────────────

export default function Engine() {
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [activeTab, setActiveTab] = useState<"open" | "history" | "learning" | "health" | "autotune">("open");

  const engineFetcher = useCallback(() => api.getEngine(), []);
  const positionsFetcher = useCallback(() => api.getPositions(), []);
  const historyFetcher = useCallback(() => api.getHistory(50), []);
  const scansFetcher = useCallback(() => api.getScans(20), []);

  const { data: state, refetch: refetchEngine } = usePolling(engineFetcher, 5000);
  const { data: positionsData, refetch: refetchPositions } = usePolling(positionsFetcher, 5000);
  const { data: historyData } = usePolling(historyFetcher, 10000);
  const { data: scansData, refetch: refetchScans } = usePolling(scansFetcher, 10000);

  const isRunning = state?.isRunning ?? state?.engine === "running" ?? false;
  const engineStatus = state?.status ?? state?.engine ?? "stopped";

  const liveEquity = parseFloat(state?.liveEquity ?? state?.currentBalance ?? "1000");
  const totalPnl = parseFloat(state?.totalPnl ?? "0");
  const totalPnlPct = parseFloat(state?.totalPnlPercent ?? "0");
  const drawdown = parseFloat(state?.drawdownPercent ?? "0");
  const wins = state?.totalWins ?? 0;
  const losses = state?.totalLosses ?? 0;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  const dailyPnl = parseFloat(state?.liveDailyPnl ?? state?.dailyPnl ?? "0");
  const dailyPnlPct = parseFloat(state?.liveDailyPnlPercent ?? "0");
  const totalUnrealizedPnl = parseFloat(state?.totalUnrealizedPnl ?? "0");

  const openPositions = positionsData?.positions ?? positionsData ?? [];
  const closedPositions = historyData?.trades ?? historyData ?? [];
  const scanLogs = scansData?.scans ?? scansData ?? [];

  const lastRealScan = Array.isArray(scanLogs) ? scanLogs.find((l: any) => l.tokensScanned > 0) : null;
  const lastAnyScan = Array.isArray(scanLogs) ? scanLogs[0] : null;

  async function handleStart() {
    setIsStarting(true);
    try {
      await api.startEngine();
      toast.success("Engine started — scanning all chains every 30 seconds");
      setTimeout(() => refetchEngine(), 1000);
    } catch (err: any) {
      toast.error(`Failed to start: ${err.message}`);
    }
    setIsStarting(false);
  }

  async function handleStop() {
    setIsStopping(true);
    try {
      await api.stopEngine();
      toast.info("Engine stopped");
      setTimeout(() => refetchEngine(), 1000);
    } catch (err: any) {
      toast.error(`Failed to stop: ${err.message}`);
    }
    setIsStopping(false);
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1400px] mx-auto">
      <Toaster position="top-right" theme="dark" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-mono flex items-center gap-3">
            Paper Trading Engine
            <StatusBadge status={engineStatus} />
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Multi-source scanner: boosted, trending, profiles & narratives — all chains every 30s
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isRunning && engineStatus !== "running" ? (
            <button
              onClick={handleStart}
              disabled={isStarting}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-sm font-bold disabled:opacity-50 transition-colors"
            >
              {isStarting ? "STARTING..." : "START ENGINE"}
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={isStopping}
              className="px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white font-mono text-sm font-bold disabled:opacity-50 transition-colors"
            >
              {isStopping ? "STOPPING..." : "STOP ENGINE"}
            </button>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard
          label="EQUITY"
          value={`$${liveEquity.toFixed(2)}`}
          sub={totalUnrealizedPnl !== 0 ? `${totalUnrealizedPnl >= 0 ? "+" : ""}$${totalUnrealizedPnl.toFixed(2)} unreal.` : undefined}
          color="text-white"
        />
        <StatCard
          label="TOTAL P&L"
          value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
          sub={`${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%`}
          color={totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <StatCard
          label="DAILY P&L"
          value={`${dailyPnl >= 0 ? "+" : ""}$${dailyPnl.toFixed(2)}`}
          sub={`${dailyPnlPct >= 0 ? "+" : ""}${dailyPnlPct.toFixed(2)}%`}
          color={dailyPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <StatCard
          label="DRAWDOWN"
          value={`${drawdown.toFixed(2)}%`}
          color={drawdown > 3 ? "text-rose-400" : "text-zinc-400"}
        />
        <StatCard
          label="WIN RATE"
          value={`${winRate.toFixed(0)}%`}
          sub={`${wins}W / ${losses}L`}
          color={winRate >= 50 ? "text-emerald-400" : "text-amber-400"}
        />
        <StatCard
          label="POSITIONS"
          value={`${Array.isArray(openPositions) ? openPositions.length : 0}/10`}
          color="text-sky-400"
        />
        <StatCard
          label="LAST SCAN"
          value={
            lastRealScan
              ? `${lastRealScan.tokensScanned}`
              : lastAnyScan
                ? "MAX POS"
                : "—"
          }
          sub={
            lastRealScan
              ? `${lastRealScan.tokensQualified} qualified`
              : lastAnyScan
                ? "10/10 — scan paused"
                : "no scans yet"
          }
          color={
            lastRealScan && lastRealScan.tokensQualified > 0
              ? "text-emerald-400"
              : "text-zinc-400"
          }
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Positions */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tab Switcher */}
          <div className="flex items-center gap-1 bg-zinc-900/50 border border-zinc-800 rounded-lg p-1">
            <button
              onClick={() => setActiveTab("open")}
              className={`flex-1 px-4 py-2 rounded text-sm font-mono font-bold transition-colors ${
                activeTab === "open"
                  ? "bg-sky-600 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              OPEN ({Array.isArray(openPositions) ? openPositions.length : 0})
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex-1 px-4 py-2 rounded text-sm font-mono font-bold transition-colors ${
                activeTab === "history"
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              HISTORY ({Array.isArray(closedPositions) ? closedPositions.length : 0})
            </button>
            <button
              onClick={() => setActiveTab("learning")}
              className={`flex-1 px-4 py-2 rounded text-sm font-mono font-bold transition-colors ${
                activeTab === "learning"
                  ? "bg-violet-600 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              LEARNING
            </button>
            <button
              onClick={() => setActiveTab("health")}
              className={`flex-1 px-4 py-2 rounded text-sm font-mono font-bold transition-colors ${
                activeTab === "health"
                  ? "bg-cyan-600 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              HEALTH
            </button>
            <button
              onClick={() => setActiveTab("autotune")}
              className={`flex-1 px-4 py-2 rounded text-sm font-mono font-bold transition-colors ${
                activeTab === "autotune"
                  ? "bg-amber-600 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              AUTO-TUNE
            </button>
          </div>

          {/* Tab Content */}
          <div className="space-y-3">
            {activeTab === "open" ? (
              !Array.isArray(openPositions) || openPositions.length === 0 ? (
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
                  <div className="text-zinc-600 text-4xl mb-3">
                    {isRunning || engineStatus === "running" ? "⏳" : "⏸"}
                  </div>
                  <div className="text-zinc-500 font-mono text-sm">
                    {isRunning || engineStatus === "running"
                      ? "Scanning for opportunities..."
                      : "Start the engine to begin paper trading"}
                  </div>
                </div>
              ) : (
                openPositions.map((pos: any, i: number) => (
                  <PositionCard key={pos.id ?? i} pos={pos} />
                ))
              )
            ) : activeTab === "history" ? (
              !Array.isArray(closedPositions) || closedPositions.length === 0 ? (
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
                  <div className="text-zinc-600 text-4xl mb-3">&#128202;</div>
                  <div className="text-zinc-500 font-mono text-sm">
                    No closed positions yet
                  </div>
                </div>
              ) : (
                closedPositions.map((pos: any, i: number) => (
                  <PositionCard key={pos.id ?? i} pos={pos} />
                ))
              )
            ) : activeTab === "learning" ? (
              <LearningPanel />
            ) : activeTab === "health" ? (
              <HealthPanel />
            ) : (
              <AutoTunerPanel />
            )}
          </div>
        </div>

        {/* Right: Scan Activity Feed */}
        <div className="space-y-4">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-mono font-bold text-zinc-300">
                SCAN ACTIVITY
              </h3>
              {(isRunning || engineStatus === "running") && (
                <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <div className="p-3 max-h-[500px] overflow-y-auto">
              {!Array.isArray(scanLogs) || scanLogs.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-zinc-600 text-2xl mb-2">&#128225;</div>
                  <div className="text-zinc-500 text-xs font-mono">
                    No scans yet
                  </div>
                </div>
              ) : (
                scanLogs.map((log: any, i: number) => (
                  <ScanLogEntry key={log.id ?? i} log={log} />
                ))
              )}
            </div>
          </div>

          {/* Engine Rules Summary */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-sm font-mono font-bold text-zinc-300 mb-3">
              ACTIVE RULES
            </h3>
            <div className="space-y-2 text-xs">
              <RuleIndicator label="Max Risk Per Trade" value="1.5%" ok={true} />
              <RuleIndicator label="Stop Loss" value="10% below entry" ok={true} />
              <RuleIndicator label="TP1 Partial" value="+25% (50% off)" ok={true} />
              <RuleIndicator label="Break-Even" value="After +15%" ok={true} />
              <RuleIndicator
                label="Max Positions"
                value={`${Array.isArray(openPositions) ? openPositions.length : 0}/10`}
                ok={!Array.isArray(openPositions) || openPositions.length < 10}
              />
              <RuleIndicator
                label="Consec. Losses"
                value={`${state?.consecutiveLosses ?? 0}/2`}
                ok={(state?.consecutiveLosses ?? 0) < 2}
              />
              <RuleIndicator
                label="Daily Drawdown"
                value={`${dailyPnlPct.toFixed(2)}%`}
                ok={dailyPnlPct > -5}
              />
              <RuleIndicator label="Min Liquidity" value="$100K" ok={true} />
              <RuleIndicator label="Entry on Pullback" value="No chase" ok={true} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── HELPER COMPONENTS ──────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
      <div className="text-[10px] text-zinc-500 font-mono mb-1">{label}</div>
      <div className={`text-lg font-mono font-bold ${color}`}>{value}</div>
      {sub && (
        <div className={`text-xs font-mono ${color} opacity-70`}>{sub}</div>
      )}
    </div>
  );
}

function RuleIndicator({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`}
        />
        <span className="text-zinc-400">{label}</span>
      </div>
      <span className={`font-mono ${ok ? "text-zinc-300" : "text-rose-400"}`}>
        {value}
      </span>
    </div>
  );
}
