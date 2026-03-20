import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import Dashboard from "@/pages/Dashboard";
import Engine from "@/pages/Engine";
import Scanner from "@/pages/Scanner";
import Journal from "@/pages/Journal";
import Alerts from "@/pages/Alerts";
import Analytics from "@/pages/Analytics";
import Backtest from "@/pages/Backtest";
import Rules from "@/pages/Rules";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/engine" element={<Engine />} />
          <Route path="/scanner" element={<Scanner />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/rules" element={<Rules />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
