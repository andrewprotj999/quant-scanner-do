/**
 * Command Center — Main Dashboard
 * Overview of engine state, positions, market intelligence, risk status
 */

import { useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  Shield,
  Target,
  Clock,
  BarChart3,
  ArrowRight,
} from "lucide-react";

export default function Dashboard() {
  const engineFetcher = useCallback(() => api.getEngine(), []);
  const positionsFetcher = useCallback(() => api.getPositions(), []);
  const historyFetcher = useCallback(() => api.getHistory(20), []);
  const scansFetcher = useCallback(() => api.getScans(10), []);
  const healthFetcher = useCallback(() => api.getHealthMetrics(), []);
  const paramsFetcher = useCallback(() => api.getParams(), []);

  const { data: engine } = usePolling(engineFetcher, 5000);
  const { data: positionsData } = usePolling(positionsFetcher, 5000);
  const { data: historyData } = usePolling(historyFetcher, 10000);
  const { data: scansData } = usePolling(scansFetcher, 10000);
  const { data: health } = usePolling(healthFetcher, 10000);
  const { data: paramsData } = usePolling(paramsFetcher, 30000);

  const positions = positionsData?.positions ?? positionsData ?? [];
  const closedTrades = historyData?.trades ?? historyData ?? [];
  const scanLogs = scansData?.scans ?? scansData ?? [];
  const params = paramsData?.params ?? paramsData ?? {};

  const isRunning = engine?.isRunning ?? engine?.engine === "running" ?? false;
  const liveEquity = parseFloat(engine?.liveEquity ?? engine?.currentBalance ?? "1000");
  const totalPnl = parseFloat(engine?.totalPnl ?? "0");
  const totalPnlPct = parseFloat(engine?.totalPnlPercent ?? "0");
  const dailyPnl = parseFloat(engine?.liveDailyPnl ?? engine?.dailyPnl ?? "0");
  const dailyPnlPct = parseFloat(engine?.liveDailyPnlPercent ?? "0");
  const drawdown = parseFloat(engine?.drawdownPercent ?? "0");
  const wins = engine?.totalWins ?? 0;
  const losses = engine?.totalLosses ?? 0;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  const totalUnrealizedPnl = parseFloat(engine?.totalUnrealizedPnl ?? "0");
  const openPositions = Array.isArray(positions) ? positions : [];
  const totalScans = engine?.totalScans ?? health?.totalCycles ?? 0;
  const successRate = health?.successRate ?? 100;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white font-mono">
            Command Center
          </h1>
          <p className="text-zinc-500 text-sm">
            Autonomous memecoin scanner — self-hosted
          </p>
        </div>
        <Link
          to="/engine"
          className="flex items-center gap-2 px-4 py-2 rounded bg-primary/10 border border-primary/30 text-primary text-sm font-mono hover:bg-primary/20 transition-colors"
        >
          <Activity className="w-4 h-4" />
          ENGINE
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Top Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard
          icon={<BarChart3 className="w-4 h-4" />}
          label="EQUITY"
          value={`$${liveEquity.toFixed(0)}`}
          sub={totalUnrealizedPnl !== 0 ? `${totalUnrealizedPnl >= 0 ? "+" : ""}$${totalUnrealizedPnl.toFixed(2)} unreal.` : undefined}
          color="text-white"
        />
        <MetricCard
          icon={totalPnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          label="TOTAL P&L"
          value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
          sub={`${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%`}
          color={totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <MetricCard
          icon={<Zap className="w-4 h-4" />}
          label="DAILY P&L"
          value={`${dailyPnl >= 0 ? "+" : ""}$${dailyPnl.toFixed(2)}`}
          sub={`${dailyPnlPct >= 0 ? "+" : ""}${dailyPnlPct.toFixed(2)}%`}
          color={dailyPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <MetricCard
          icon={<Target className="w-4 h-4" />}
          label="WIN RATE"
          value={`${winRate.toFixed(0)}%`}
          sub={`${wins}W / ${losses}L`}
          color={winRate >= 50 ? "text-emerald-400" : "text-amber-400"}
        />
        <MetricCard
          icon={<Shield className="w-4 h-4" />}
          label="DRAWDOWN"
          value={`${drawdown.toFixed(2)}%`}
          color={drawdown > 3 ? "text-rose-400" : "text-zinc-400"}
        />
        <MetricCard
          icon={<Clock className="w-4 h-4" />}
          label="SCANS"
          value={totalScans.toString()}
          sub={`${successRate.toFixed(0)}% success`}
          color="text-sky-400"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Open Positions */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-mono font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Open Positions ({openPositions.length})
            </h2>
            <Link
              to="/engine"
              className="text-xs font-mono text-primary hover:text-primary/80"
            >
              View All →
            </Link>
          </div>

          {openPositions.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
              <div className="text-zinc-600 text-4xl mb-3">
                {isRunning || engine?.engine === "running" ? "⏳" : "⏸"}
              </div>
              <div className="text-zinc-500 font-mono text-sm">
                {isRunning || engine?.engine === "running"
                  ? "Scanning for opportunities..."
                  : "Engine is stopped"}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {openPositions.slice(0, 6).map((pos: any, i: number) => {
                const pnlPct = parseFloat(pos.unrealizedPnlPercent ?? pos.pnlPercent ?? "0");
                const pnl = parseFloat(pos.unrealizedPnl ?? pos.pnl ?? "0");
                const isProfit = pnl >= 0;
                return (
                  <div
                    key={pos.id ?? i}
                    className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-8 rounded-full ${isProfit ? "bg-emerald-500" : "bg-rose-500"}`} />
                      <div>
                        <span className="font-mono font-bold text-white">
                          {pos.tokenSymbol ?? pos.symbol}
                        </span>
                        <span className="text-xs text-zinc-500 ml-2">{pos.chain}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
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
                      <div className="text-right">
                        <div className={`font-mono font-bold ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                          {isProfit ? "+" : ""}{pnlPct.toFixed(2)}%
                        </div>
                        <div className={`text-xs font-mono ${isProfit ? "text-emerald-400/70" : "text-rose-400/70"}`}>
                          {isProfit ? "+" : ""}${pnl.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recent Closed Trades */}
          {Array.isArray(closedTrades) && closedTrades.length > 0 && (
            <div>
              <h2 className="text-lg font-mono font-bold text-white flex items-center gap-2 mb-3">
                <Clock className="w-5 h-5 text-zinc-400" />
                Recent Trades
              </h2>
              <div className="space-y-2">
                {closedTrades.slice(0, 5).map((trade: any, i: number) => {
                  const pnlPct = parseFloat(trade.realizedPnlPercent ?? trade.pnlPercent ?? "0");
                  const isWin = pnlPct >= 0;
                  return (
                    <div
                      key={trade.id ?? i}
                      className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-8 rounded-full ${isWin ? "bg-emerald-500" : "bg-rose-500"}`} />
                        <div>
                          <span className="font-mono font-bold text-white">
                            {trade.tokenSymbol ?? trade.symbol}
                          </span>
                          <span className="text-xs text-zinc-500 ml-2">{trade.chain}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-zinc-500 font-mono">
                          {trade.exitReason ?? trade.reason ?? "closed"}
                        </span>
                        <span className={`font-mono font-bold ${isWin ? "text-emerald-400" : "text-rose-400"}`}>
                          {isWin ? "+" : ""}{pnlPct.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Engine Status + Scan Feed */}
        <div className="space-y-4">
          {/* Engine Status */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-sm font-mono font-bold text-zinc-300 mb-3">
              ENGINE STATUS
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Status</span>
                <span className={`text-xs font-mono font-bold ${
                  isRunning || engine?.engine === "running" ? "text-emerald-400" : "text-zinc-400"
                }`}>
                  {(engine?.status ?? engine?.engine ?? "stopped").toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Health</span>
                <span className="text-xs font-mono text-emerald-400">
                  {health?.grade ?? (successRate >= 90 ? "EXCELLENT" : "GOOD")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Avg Cycle</span>
                <span className="text-xs font-mono text-zinc-300">
                  {((health?.avgCycleDurationMs ?? 0) / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Uptime</span>
                <span className="text-xs font-mono text-zinc-300">
                  {health?.uptime
                    ? health.uptime > 3600000
                      ? `${(health.uptime / 3600000).toFixed(1)}h`
                      : `${Math.round(health.uptime / 60000)}m`
                    : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Risk Status */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-sm font-mono font-bold text-zinc-300 mb-3">
              RISK STATUS
            </h3>
            <div className="space-y-2 text-xs">
              <RiskItem
                label="Daily Drawdown"
                value={`${dailyPnlPct.toFixed(2)}%`}
                limit="-5%"
                ok={dailyPnlPct > -5}
              />
              <RiskItem
                label="Max Drawdown"
                value={`${drawdown.toFixed(2)}%`}
                limit="10%"
                ok={drawdown < 10}
              />
              <RiskItem
                label="Consec. Losses"
                value={`${engine?.consecutiveLosses ?? 0}`}
                limit="2"
                ok={(engine?.consecutiveLosses ?? 0) < 2}
              />
              <RiskItem
                label="Open Positions"
                value={`${openPositions.length}`}
                limit="10"
                ok={openPositions.length < 10}
              />
            </div>
          </div>

          {/* Recent Scans */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-mono font-bold text-zinc-300">
                SCAN FEED
              </h3>
              {(isRunning || engine?.engine === "running") && (
                <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <div className="p-3 max-h-[300px] overflow-y-auto">
              {!Array.isArray(scanLogs) || scanLogs.length === 0 ? (
                <div className="text-center py-6">
                  <div className="text-zinc-600 text-xl mb-1">&#128225;</div>
                  <div className="text-zinc-500 text-xs font-mono">No scans yet</div>
                </div>
              ) : (
                scanLogs.slice(0, 8).map((log: any, i: number) => (
                  <div key={log.id ?? i} className="flex items-center gap-2 py-1.5 border-b border-zinc-800/50 last:border-0 text-xs">
                    <div
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        log.tradesExecuted > 0
                          ? "bg-emerald-500"
                          : "bg-zinc-600"
                      }`}
                    />
                    <span className="text-zinc-500 font-mono">
                      {new Date(log.scanTime).toLocaleTimeString()}
                    </span>
                    <span className="text-zinc-600">|</span>
                    <span className="text-zinc-400">{log.tokensScanned} scanned</span>
                    {log.tokensQualified > 0 && (
                      <span className="text-emerald-400">{log.tokensQualified} qual.</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-zinc-500">{icon}</span>
        <span className="text-[10px] text-zinc-500 font-mono">{label}</span>
      </div>
      <div className={`text-lg font-mono font-bold ${color}`}>{value}</div>
      {sub && (
        <div className={`text-xs font-mono ${color} opacity-70`}>{sub}</div>
      )}
    </div>
  );
}

function RiskItem({
  label,
  value,
  limit,
  ok,
}: {
  label: string;
  value: string;
  limit: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`} />
        <span className="text-zinc-400">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`font-mono ${ok ? "text-zinc-300" : "text-rose-400"}`}>{value}</span>
        <span className="text-zinc-600 font-mono">/ {limit}</span>
      </div>
    </div>
  );
}
