import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Zap, RefreshCw } from "lucide-react";

export default function Positions() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const d = await api.getPositions();
      setData(d);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap size={24} className="text-accent" />
          Open Positions
        </h1>
        <button onClick={load} className="text-text-muted hover:text-text p-2 rounded-lg hover:bg-bg-hover transition-colors">
          <RefreshCw size={18} />
        </button>
      </div>

      {loading ? (
        <div className="text-text-muted animate-pulse">Loading...</div>
      ) : !data?.positions?.length ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-text-muted">No open positions. Engine will open positions when qualifying setups are found.</p>
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wide">
                <th className="text-left p-4">Token</th>
                <th className="text-left p-4">Chain</th>
                <th className="text-right p-4">Entry</th>
                <th className="text-right p-4">Current</th>
                <th className="text-right p-4">P&L %</th>
                <th className="text-right p-4">P&L $</th>
                <th className="text-right p-4">Size</th>
                <th className="text-right p-4">Score</th>
                <th className="text-center p-4">TP1</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map((p: any) => {
                const pnl = parseFloat(p.pnlPercent || "0");
                return (
                  <tr key={p.id} className="border-b border-border/30 hover:bg-bg-hover transition-colors">
                    <td className="p-4 font-mono font-medium">{p.tokenSymbol}</td>
                    <td className="p-4 text-text-muted">{p.chain}</td>
                    <td className="p-4 text-right font-mono text-xs">${parseFloat(p.entryPrice).toFixed(8)}</td>
                    <td className="p-4 text-right font-mono text-xs">${parseFloat(p.currentPrice).toFixed(8)}</td>
                    <td className={`p-4 text-right font-mono font-medium ${pnl >= 0 ? "text-accent" : "text-danger"}`}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                    </td>
                    <td className={`p-4 text-right font-mono ${pnl >= 0 ? "text-accent" : "text-danger"}`}>
                      ${parseFloat(p.pnlUsd || "0").toFixed(2)}
                    </td>
                    <td className="p-4 text-right font-mono">${parseFloat(p.positionSizeUsd).toFixed(0)}</td>
                    <td className="p-4 text-right">
                      <span className="bg-accent/15 text-accent px-2 py-0.5 rounded text-xs font-mono">
                        {p.convictionScore}/100
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      {p.tp1Hit ? (
                        <span className="text-accent text-xs">HIT</span>
                      ) : (
                        <span className="text-text-muted text-xs">—</span>
                      )}
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
