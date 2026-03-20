import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BarChart3, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";

export default function Health() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const d = await api.getHealthMetrics();
      setData(d);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
  }, []);

  const health = data?.health;
  const cycles = data?.recentCycles || [];
  const errors = data?.recentErrors || [];

  const gradeColor = (g: string) => {
    if (g === "EXCELLENT" || g === "GOOD") return "text-accent";
    if (g === "DEGRADED") return "text-warning";
    return "text-danger";
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 size={24} className="text-accent" />
          System Health
        </h1>
        <button onClick={load} className="text-text-muted hover:text-text p-2 rounded-lg hover:bg-bg-hover transition-colors">
          <RefreshCw size={18} />
        </button>
      </div>

      {loading ? (
        <div className="text-text-muted animate-pulse">Loading...</div>
      ) : (
        <>
          {/* Health Overview */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-text-muted uppercase">Grade</p>
              <p className={`text-2xl font-bold font-mono mt-1 ${gradeColor(health?.grade || "")}`}>
                {health?.grade || "—"}
              </p>
            </div>
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-text-muted uppercase">Success Rate</p>
              <p className="text-2xl font-bold font-mono mt-1">
                {health?.successRate ? `${(health.successRate * 100).toFixed(1)}%` : "—"}
              </p>
            </div>
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-text-muted uppercase">Avg Cycle</p>
              <p className="text-2xl font-bold font-mono mt-1">
                {health?.avgCycleMs ? `${(health.avgCycleMs / 1000).toFixed(1)}s` : "—"}
              </p>
            </div>
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-text-muted uppercase">API Errors</p>
              <p className="text-2xl font-bold font-mono mt-1">
                {health?.apiErrorRate ? `${(health.apiErrorRate * 100).toFixed(1)}%` : "0%"}
              </p>
            </div>
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-text-muted uppercase">Total Cycles</p>
              <p className="text-2xl font-bold font-mono mt-1">
                {health?.totalCycles?.toLocaleString() || "0"}
              </p>
            </div>
          </div>

          {/* Recent Cycles */}
          <div className="bg-bg-card border border-border rounded-xl p-5">
            <h2 className="text-lg font-semibold mb-4">Recent Cycles</h2>
            {cycles.length > 0 ? (
              <div className="space-y-2">
                {cycles.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                    {c.success ? (
                      <CheckCircle size={16} className="text-accent shrink-0" />
                    ) : (
                      <AlertTriangle size={16} className="text-danger shrink-0" />
                    )}
                    <span className="font-mono text-xs text-text-muted w-24">
                      {(c.durationMs / 1000).toFixed(1)}s
                    </span>
                    <span className="text-sm">
                      Scanned {c.tokensScanned} | Qualified {c.tokensQualified} | Executed {c.tradesExecuted}
                    </span>
                    <span className="text-xs text-text-muted ml-auto">
                      {new Date(c.startTime).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-muted text-sm">No cycle data yet</p>
            )}
          </div>

          {/* Recent Errors */}
          {errors.length > 0 && (
            <div className="bg-bg-card border border-danger/30 rounded-xl p-5">
              <h2 className="text-lg font-semibold mb-4 text-danger flex items-center gap-2">
                <AlertTriangle size={18} />
                Recent Errors
              </h2>
              <div className="space-y-2">
                {errors.map((e: any, i: number) => (
                  <div key={i} className="py-2 border-b border-border/30 last:border-0">
                    <p className="text-sm text-danger">{e.message}</p>
                    <p className="text-xs text-text-muted mt-1">
                      {e.category} — {new Date(e.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
