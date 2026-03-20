import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { History, TrendingUp, TrendingDown } from "lucide-react";

export default function TradeHistory() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getHistory(100).then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  const trades = data?.trades || [];
  const wins = trades.filter((t: any) => parseFloat(t.pnl || "0") >= 0).length;
  const losses = trades.length - wins;
  const totalPnl = trades.reduce((s: number, t: any) => s + parseFloat(t.pnl || "0"), 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <History size={24} className="text-accent" />
        Trade History
      </h1>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="Total Trades" value={trades.length.toString()} />
        <SummaryCard label="Wins" value={wins.toString()} color="text-accent" />
        <SummaryCard label="Losses" value={losses.toString()} color="text-danger" />
        <SummaryCard
          label="Total P&L"
          value={`$${totalPnl.toFixed(2)}`}
          color={totalPnl >= 0 ? "text-accent" : "text-danger"}
        />
      </div>

      {loading ? (
        <div className="text-text-muted animate-pulse">Loading...</div>
      ) : !trades.length ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-text-muted">No closed trades yet.</p>
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wide">
                <th className="text-left p-4">Pair</th>
                <th className="text-left p-4">Chain</th>
                <th className="text-right p-4">Entry</th>
                <th className="text-right p-4">Exit</th>
                <th className="text-right p-4">P&L %</th>
                <th className="text-right p-4">P&L $</th>
                <th className="text-right p-4">Score</th>
                <th className="text-left p-4">Exit Reason</th>
                <th className="text-right p-4">Date</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t: any) => {
                const pnl = parseFloat(t.pnlPercent || t.pnl_percent || "0");
                const pnlUsd = parseFloat(t.pnl || "0");
                return (
                  <tr key={t.id} className="border-b border-border/30 hover:bg-bg-hover transition-colors">
                    <td className="p-4 font-mono font-medium">{t.pair || t.tokenSymbol}</td>
                    <td className="p-4 text-text-muted">{t.chain}</td>
                    <td className="p-4 text-right font-mono text-xs">${parseFloat(t.entryPrice).toFixed(8)}</td>
                    <td className="p-4 text-right font-mono text-xs">${parseFloat(t.exitPrice).toFixed(8)}</td>
                    <td className={`p-4 text-right font-mono font-medium ${pnl >= 0 ? "text-accent" : "text-danger"}`}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                    </td>
                    <td className={`p-4 text-right font-mono ${pnlUsd >= 0 ? "text-accent" : "text-danger"}`}>
                      ${pnlUsd.toFixed(2)}
                    </td>
                    <td className="p-4 text-right">
                      <span className="bg-accent/10 text-accent px-2 py-0.5 rounded text-xs font-mono">
                        {t.conviction}/100
                      </span>
                    </td>
                    <td className="p-4 text-text-muted text-xs max-w-[200px] truncate">{t.exitReason}</td>
                    <td className="p-4 text-right text-text-muted text-xs">
                      {t.exitDate ? new Date(t.exitDate).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color = "text-text" }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold font-mono mt-1 ${color}`}>{value}</p>
    </div>
  );
}
