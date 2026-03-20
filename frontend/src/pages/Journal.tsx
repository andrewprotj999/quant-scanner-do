import { useCallback } from "react";
import { BookOpen, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";

export default function Journal() {
  const historyFetcher = useCallback(() => api.getHistory(100), []);
  const { data: historyData, isLoading } = usePolling(historyFetcher, 15000);

  const trades = historyData?.trades ?? historyData ?? [];

  const totalTrades = Array.isArray(trades) ? trades.length : 0;
  const wins = Array.isArray(trades) ? trades.filter((t: any) => parseFloat(t.realizedPnlPercent ?? t.pnlPercent ?? "0") >= 0).length : 0;
  const losses = totalTrades - wins;
  const totalPnl = Array.isArray(trades)
    ? trades.reduce((sum: number, t: any) => sum + parseFloat(t.realizedPnl ?? t.pnl ?? "0"), 0)
    : 0;

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white font-mono flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-primary" />
          Trade Journal
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Complete history of all closed trades
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 font-mono mb-1">TOTAL TRADES</div>
          <div className="text-lg font-mono font-bold text-white">{totalTrades}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 font-mono mb-1">WINS</div>
          <div className="text-lg font-mono font-bold text-emerald-400">{wins}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 font-mono mb-1">LOSSES</div>
          <div className="text-lg font-mono font-bold text-rose-400">{losses}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 font-mono mb-1">TOTAL P&L</div>
          <div className={`text-lg font-mono font-bold ${totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Trade List */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="text-zinc-600 text-4xl mb-3 animate-pulse">&#128214;</div>
          <div className="text-zinc-500 font-mono text-sm">Loading trades...</div>
        </div>
      ) : !Array.isArray(trades) || trades.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-12 text-center">
          <div className="text-zinc-600 text-4xl mb-3">&#128214;</div>
          <div className="text-zinc-400 font-mono text-sm font-bold mb-2">NO TRADES YET</div>
          <div className="text-zinc-500 text-xs">
            Closed trades will appear here as the engine executes
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {trades.map((trade: any, i: number) => {
            const pnl = parseFloat(trade.realizedPnl ?? trade.pnl ?? "0");
            const pnlPct = parseFloat(trade.realizedPnlPercent ?? trade.pnlPercent ?? "0");
            const isWin = pnl >= 0;
            return (
              <div
                key={trade.id ?? i}
                className={`bg-zinc-900/50 border border-zinc-800 border-l-4 ${isWin ? "border-l-emerald-500" : "border-l-rose-500"} rounded-lg p-4`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-white text-lg">
                      {trade.tokenSymbol ?? trade.symbol}
                    </span>
                    <span className="text-xs text-zinc-500 font-mono">{trade.chain}</span>
                    <span className="text-xs text-zinc-600 font-mono">
                      {trade.exitReason ?? trade.reason ?? "closed"}
                    </span>
                  </div>
                  <span className={`font-mono font-bold text-lg ${isWin ? "text-emerald-400" : "text-rose-400"}`}>
                    {isWin ? "+" : ""}{pnlPct.toFixed(2)}%
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-zinc-500 block">ENTRY</span>
                    <span className="text-white font-mono">${parseFloat(trade.entryPrice ?? "0").toFixed(8)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">EXIT</span>
                    <span className="text-white font-mono">${parseFloat(trade.currentPrice ?? trade.exitPrice ?? "0").toFixed(8)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">SIZE</span>
                    <span className="text-white font-mono">${parseFloat(trade.positionSize ?? "0").toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">P&L</span>
                    <span className={`font-mono font-bold ${isWin ? "text-emerald-400" : "text-rose-400"}`}>
                      {isWin ? "+" : ""}${pnl.toFixed(2)}
                    </span>
                  </div>
                </div>
                {trade.entryReason && (
                  <div className="mt-2 text-xs text-zinc-500">
                    <span className="text-zinc-600">REASON: </span>{trade.entryReason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
