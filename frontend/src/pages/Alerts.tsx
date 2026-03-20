import { Bell, Plus, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";

interface PriceAlert {
  id: string;
  symbol: string;
  chain: string;
  targetPrice: number;
  direction: "above" | "below";
  active: boolean;
  createdAt: number;
}

export default function Alerts() {
  const [alerts, setAlerts] = useState<PriceAlert[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("price_alerts") || "[]");
    } catch {
      return [];
    }
  });
  const [showForm, setShowForm] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [chain, setChain] = useState("solana");
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");

  useEffect(() => {
    localStorage.setItem("price_alerts", JSON.stringify(alerts));
  }, [alerts]);

  function addAlert() {
    if (!symbol || !targetPrice) return;
    const newAlert: PriceAlert = {
      id: Date.now().toString(),
      symbol: symbol.toUpperCase(),
      chain,
      targetPrice: parseFloat(targetPrice),
      direction,
      active: true,
      createdAt: Date.now(),
    };
    setAlerts((prev) => [newAlert, ...prev]);
    setSymbol("");
    setTargetPrice("");
    setShowForm(false);
  }

  function removeAlert(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  function toggleAlert(id: string) {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, active: !a.active } : a))
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white font-mono flex items-center gap-3">
            <Bell className="w-6 h-6 text-primary" />
            Price Alerts
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Set price alerts for tokens you're watching (stored locally)
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded bg-primary hover:bg-primary/80 text-white font-mono text-sm font-bold transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          NEW ALERT
        </button>
      </div>

      {/* Add Alert Form */}
      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-mono font-bold text-zinc-300 mb-3">NEW ALERT</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="Symbol (e.g., SOL)"
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-sm placeholder:text-zinc-600 focus:outline-none focus:border-primary/50"
            />
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-primary/50"
            >
              <option value="solana">Solana</option>
              <option value="ethereum">Ethereum</option>
              <option value="base">Base</option>
              <option value="bsc">BSC</option>
            </select>
            <div className="flex gap-2">
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as "above" | "below")}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-primary/50"
              >
                <option value="above">Above</option>
                <option value="below">Below</option>
              </select>
              <input
                type="number"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="Price"
                step="any"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-sm placeholder:text-zinc-600 focus:outline-none focus:border-primary/50"
              />
            </div>
            <button
              onClick={addAlert}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-sm font-bold transition-colors"
            >
              CREATE
            </button>
          </div>
        </div>
      )}

      {/* Alerts List */}
      {alerts.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-12 text-center">
          <div className="text-zinc-600 text-4xl mb-3">&#128276;</div>
          <div className="text-zinc-400 font-mono text-sm font-bold mb-2">NO ALERTS SET</div>
          <div className="text-zinc-500 text-xs">
            Create price alerts to track tokens you're watching
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 flex items-center justify-between ${
                !alert.active ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-2 h-8 rounded-full ${
                    alert.direction === "above" ? "bg-emerald-500" : "bg-rose-500"
                  }`}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white">{alert.symbol}</span>
                    <span className="text-xs text-zinc-500">{alert.chain}</span>
                  </div>
                  <div className="text-xs text-zinc-500 font-mono">
                    {alert.direction === "above" ? "↑ Above" : "↓ Below"} ${alert.targetPrice}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleAlert(alert.id)}
                  className={`px-3 py-1 rounded text-xs font-mono border transition-colors ${
                    alert.active
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30"
                      : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:bg-zinc-700"
                  }`}
                >
                  {alert.active ? "ACTIVE" : "PAUSED"}
                </button>
                <button
                  onClick={() => removeAlert(alert.id)}
                  className="text-zinc-500 hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
