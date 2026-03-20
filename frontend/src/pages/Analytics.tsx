import { useCallback } from "react";
import { BarChart3, TrendingUp, Target, Clock, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";

export default function Analytics() {
  const engineFetcher = useCallback(() => api.getEngine(), []);
  const historyFetcher = useCallback(() => api.getHistory(200), []);
  const healthFetcher = useCallback(() => api.getHealthMetrics(), []);
  const patternsFetcher = useCallback(() => api.getPatterns(), []);

  const { data: engine } = usePolling(engineFetcher, 10000);
  const { data: historyData } = usePolling(historyFetcher, 15000);
  const { data: health } = usePolling(healthFetcher, 10000);
  const { data: patternsData } = usePolling(patternsFetcher, 30000);

  const trades = historyData?.trades ?? historyData ?? [];
  const patterns = patternsData?.patterns ?? patternsData ?? [];

  const totalTrades = Array.isArray(trades) ? trades.length : 0;
  const wins = Array.isArray(trades) ? trades.filter((t: any) => parseFloat(t.realizedPnlPercent ?? t.pnlPercent ?? "0") >= 0).length : 0;
  const losses = totalTrades - wins;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const totalPnl = Array.isArray(trades)
    ? trades.reduce((sum: number, t: any) => sum + parseFloat(t.realizedPnl ?? t.pnl ?? "0"), 0)
    : 0;
  const avgWin = wins > 0
    ? (Array.isArray(trades) ? trades.filter((t: any) => parseFloat(t.realizedPnlPercent ?? t.pnlPercent ?? "0") >= 0) : [])
        .reduce((sum: number, t: any) => sum + parseFloat(t.realizedPnlPercent ?? t.pnlPercent ?? "0"), 0) / wins
    : 0;
  const avgLoss = losses > 0
    ? (Array.isArray(trades) ? trades.filter((t: any) => parseFloat(t.realizedPnlPercent ?? t.pnlPercent ?? "0") < 0) : [])
        .reduce((sum: number, t: any) => sum + parseFloat(t.realizedPnlPercent ?? t.pnlPercent ?? "0"), 0) / losses
    : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin * wins) / Math.abs(avgLoss * losses) : 0;

  // Group by chain
  const chainStats = Array.isArray(trades) ? trades.reduce((acc: any, t: any) => {
    const chain = t.chain ?? "unknown";
    if (!acc[chain]) acc[chain] = { wins: 0, losses: 0, pnl: 0 };
    const pnl = parseFloat(t.realizedPnl ?? t.pnl ?? "0");
    if (pnl >= 0) acc[chain].wins++;
    else acc[chain].losses++;
    acc[chain].pnl += pnl;
    return acc;
  }, {}) : {};

  // Group by exit reason
  const exitStats = Array.isArray(trades) ? trades.reduce((acc: any, t: any) => {
    const reason = t.exitReason ?? t.reason ?? "unknown";
    if (!acc[reason]) acc[reason] = { count: 0, pnl: 0 };
    acc[reason].count++;
    acc[reason].pnl += parseFloat(t.realizedPnl ?? t.pnl ?? "0");
    return acc;
  }, {}) : {};

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white font-mono flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-primary" />
          Analytics
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Performance analytics and pattern insights
        </p>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="TOTAL TRADES" value={totalTrades.toString()} color="text-white" />
        <StatCard label="WIN RATE" value={`${winRate.toFixed(0)}%`} sub={`${wins}W / ${losses}L`} color={winRate >= 50 ? "text-emerald-400" : "text-rose-400"} />
        <StatCard label="TOTAL P&L" value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
        <StatCard label="AVG WIN" value={`+${avgWin.toFixed(2)}%`} color="text-emerald-400" />
        <StatCard label="AVG LOSS" value={`${avgLoss.toFixed(2)}%`} color="text-rose-400" />
        <StatCard label="PROFIT FACTOR" value={profitFactor.toFixed(2)} color={profitFactor >= 1 ? "text-emerald-400" : "text-rose-400"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chain Performance */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-mono font-bold text-zinc-300">PERFORMANCE BY CHAIN</h3>
          </div>
          <div className="p-4">
            {Object.keys(chainStats).length === 0 ? (
              <div className="text-center py-6 text-zinc-500 text-xs font-mono">No data yet</div>
            ) : (
              <div className="space-y-3">
                {Object.entries(chainStats).map(([chain, stats]: [string, any]) => {
                  const total = stats.wins + stats.losses;
                  const wr = total > 0 ? (stats.wins / total) * 100 : 0;
                  return (
                    <div key={chain} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono text-white font-bold">{chain}</span>
                        <span className="text-xs text-zinc-500">{total} trades</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-mono">
                        <span className={wr >= 50 ? "text-emerald-400" : "text-rose-400"}>{wr.toFixed(0)}% WR</span>
                        <span className={stats.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                          {stats.pnl >= 0 ? "+" : ""}${stats.pnl.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Exit Reason Breakdown */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-mono font-bold text-zinc-300">EXIT REASONS</h3>
          </div>
          <div className="p-4">
            {Object.keys(exitStats).length === 0 ? (
              <div className="text-center py-6 text-zinc-500 text-xs font-mono">No data yet</div>
            ) : (
              <div className="space-y-3">
                {Object.entries(exitStats)
                  .sort(([, a]: any, [, b]: any) => b.count - a.count)
                  .map(([reason, stats]: [string, any]) => (
                    <div key={reason} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono text-zinc-300">{reason}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-mono">
                        <span className="text-zinc-500">{stats.count}x</span>
                        <span className={stats.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                          {stats.pnl >= 0 ? "+" : ""}${stats.pnl.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Learning Patterns Summary */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg lg:col-span-2">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-mono font-bold text-zinc-300">
              LEARNING PATTERNS ({Array.isArray(patterns) ? patterns.length : 0})
            </h3>
          </div>
          <div className="p-4">
            {!Array.isArray(patterns) || patterns.length === 0 ? (
              <div className="text-center py-6">
                <div className="text-zinc-600 text-2xl mb-2">&#129504;</div>
                <div className="text-zinc-500 text-xs font-mono">
                  Patterns build as trades close. The engine tracks 7 categories and auto-adjusts scoring.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {patterns.slice(0, 12).map((p: any, i: number) => {
                  const wr = p.totalTrades > 0 ? (p.winTrades / p.totalTrades) * 100 : 0;
                  const adj = p.scoreAdjustment ?? 0;
                  return (
                    <div key={p.id ?? i} className="flex items-center justify-between py-1.5 px-2 rounded bg-zinc-800/50">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${adj > 0 ? "bg-emerald-500" : adj < 0 ? "bg-rose-500" : "bg-zinc-600"}`} />
                        <span className="text-xs font-mono text-zinc-300 truncate max-w-[120px]">{p.patternKey}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="text-zinc-500">{p.totalTrades}t</span>
                        <span className={wr >= 50 ? "text-emerald-400" : "text-rose-400"}>{wr.toFixed(0)}%</span>
                        {adj !== 0 && (
                          <span className={adj > 0 ? "text-emerald-400" : "text-rose-400"}>
                            {adj > 0 ? "+" : ""}{adj}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
      <div className="text-[10px] text-zinc-500 font-mono mb-1">{label}</div>
      <div className={`text-lg font-mono font-bold ${color}`}>{value}</div>
      {sub && <div className={`text-xs font-mono ${color} opacity-70`}>{sub}</div>}
    </div>
  );
}
