/**
 * Dashboard Layout — Dark Command Center
 * Persistent sidebar + top command bar + content area
 * Synced with Paper Trading Engine for live stats (REST API version)
 */

import { Link, useLocation, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Radar,
  BookOpen,
  Shield,
  Activity,
  AlertTriangle,
  TrendingUp,
  Bell,
  BarChart3,
  Bot,
  FlaskConical,
} from "lucide-react";
import { motion } from "framer-motion";
import { useTime } from "@/hooks/useTime";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/api";
import { useCallback } from "react";


const navItems = [
  { path: "/", label: "COMMAND", icon: LayoutDashboard },
  { path: "/scanner", label: "SCANNER", icon: Radar },
  { path: "/journal", label: "JOURNAL", icon: BookOpen },
  { path: "/alerts", label: "ALERTS", icon: Bell },
  { path: "/analytics", label: "ANALYTICS", icon: BarChart3 },
  { path: "/engine", label: "ENGINE", icon: Bot },
  { path: "/backtest", label: "BACKTEST", icon: FlaskConical },
  { path: "/rules", label: "RULES", icon: Shield },
];

export default function DashboardLayout() {
  const location = useLocation();

  const engineFetcher = useCallback(() => api.getEngine(), []);
  const positionsFetcher = useCallback(() => api.getPositions(), []);

  const { data: engine } = usePolling(engineFetcher, 10000);
  const { data: positionsData } = usePolling(positionsFetcher, 10000);

  const positions = positionsData?.positions ?? positionsData ?? [];

  // Derived live stats from engine
  const liveEquity = engine ? parseFloat(engine.liveEquity ?? engine.currentBalance ?? "1000") : 1000;
  const dailyPnlPct = engine ? parseFloat(engine.liveDailyPnlPercent ?? "0") : 0;
  const engineRunning = engine?.isRunning ?? engine?.engine === "running" ?? false;
  const engineStatus = engine?.status ?? engine?.engine ?? "stopped";
  const wins = engine?.totalWins ?? 0;
  const losses = engine?.totalLosses ?? 0;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  const openCount = Array.isArray(positions) ? positions.length : 0;
  const consecutiveLosses = engine?.consecutiveLosses ?? 0;

  const now = useTime();

  // System status derived from engine state
  const systemStatus = engineStatus === "daily_halt"
    ? "HALTED"
    : engineStatus === "loss_pause"
    ? "PAUSED"
    : engineRunning || engineStatus === "running"
    ? "LIVE"
    : "OPERATIONAL";

  const statusColor = systemStatus === "HALTED"
    ? "text-danger"
    : systemStatus === "PAUSED"
    ? "text-caution"
    : systemStatus === "LIVE"
    ? "text-safe"
    : "text-safe";

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-16 lg:w-56 flex-shrink-0 border-r border-border bg-sidebar flex flex-col">
        {/* Logo area */}
        <div className="h-14 flex items-center px-3 lg:px-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-sm bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Activity className="w-4 h-4 text-primary" />
            </div>
            <div className="hidden lg:block">
              <div className="text-xs font-semibold tracking-wider text-foreground">QUANT</div>
              <div className="text-[10px] text-muted-foreground tracking-widest">FRAMEWORK</div>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-3 px-2 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link key={item.path} to={item.path}>
                <div
                  className={`flex items-center gap-3 px-2 lg:px-3 py-2.5 rounded-sm transition-all duration-150 group relative ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute left-0 top-1 bottom-1 w-0.5 bg-primary rounded-full"
                    />
                  )}
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="hidden lg:block text-xs font-medium tracking-wider">
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Account summary at bottom — synced with engine */}
        <div className="border-t border-border p-3 hidden lg:block">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="data-label">EQUITY</span>
              <span className="font-mono text-sm font-semibold text-foreground">
                ${liveEquity > 0 ? liveEquity.toFixed(0) : "1,000"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="data-label">WIN RATE</span>
              <span className="font-mono text-sm font-semibold text-foreground">
                {winRate.toFixed(0)}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="data-label">POSITIONS</span>
              <span className="font-mono text-sm font-semibold text-foreground">
                {openCount}/10
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top command bar — synced with engine */}
        <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-card flex-shrink-0">
          <div className="flex items-center gap-6">
            {/* System status */}
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  systemStatus === "OPERATIONAL" || systemStatus === "LIVE"
                    ? "bg-safe animate-pulse"
                    : systemStatus === "PAUSED"
                    ? "bg-caution animate-pulse"
                    : "bg-danger animate-pulse"
                }`}
              />
              <span className={`text-xs font-mono font-semibold tracking-wider ${statusColor}`}>
                {systemStatus}
              </span>
            </div>

            {/* Daily P&L — from engine */}
            <div className="hidden sm:flex items-center gap-2">
              <span className="data-label">DAILY P&L</span>
              <span
                className={`font-mono text-sm font-semibold ${
                  dailyPnlPct >= 0 ? "text-safe" : "text-danger"
                }`}
              >
                {dailyPnlPct >= 0 ? "+" : ""}
                {dailyPnlPct.toFixed(2)}%
              </span>
            </div>

            {/* Consecutive losses */}
            {consecutiveLosses > 0 && (
              <div className="hidden md:flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-caution" />
                <span className="text-xs font-mono text-caution">
                  {consecutiveLosses} CONSECUTIVE LOSS{consecutiveLosses > 1 ? "ES" : ""}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Open positions count — from engine */}
            <div className="flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-mono text-muted-foreground">
                {openCount} OPEN
              </span>
            </div>

            {/* Time */}
            <div className="text-xs font-mono text-muted-foreground">
              {now.toLocaleTimeString("en-US", { hour12: false })}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
