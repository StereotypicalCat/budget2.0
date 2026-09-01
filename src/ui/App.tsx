import { BrowserRouter, Navigate, Route, Routes, NavLink } from "react-router";
import { ROUTER_BASENAME } from "./basePath.ts";
import { currentMonth } from "../store/index.ts";
import { MonthRoute } from "./routes/MonthRoute.tsx";
import { YearRoute } from "./routes/YearRoute.tsx";
import { PostMonthRoute } from "./routes/PostMonthRoute.tsx";
import { PostYearRoute } from "./routes/PostYearRoute.tsx";
import { SummaryRoute } from "./routes/SummaryRoute.tsx";
import { SettingsRoute } from "./routes/SettingsRoute.tsx";
import { UpdatePrompt } from "./components/UpdatePrompt.tsx";
import { RouteErrorBoundaryReset } from "./components/ErrorBoundary.tsx";

export function AppRoutes() {
  const year = currentMonth.slice(0, 4);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="flex gap-4 border-b px-6 py-3 text-sm">
        <NavLink to={`/month/${currentMonth}`} className="hover:underline">
          Month
        </NavLink>
        <NavLink to={`/year/${year}`} className="hover:underline">
          Year
        </NavLink>
        <NavLink to="/summary" className="hover:underline">
          Summary
        </NavLink>
        <NavLink to="/settings" className="ml-auto hover:underline">
          Settings
        </NavLink>
      </nav>
      <main className="p-6">
        <RouteErrorBoundaryReset>
          <Routes>
            <Route path="/month/:monthId" element={<MonthRoute />} />
            <Route path="/year/:year" element={<YearRoute />} />
            <Route path="/post/:postId/month/:monthId" element={<PostMonthRoute />} />
            <Route path="/post/:postId/year/:year" element={<PostYearRoute />} />
            <Route path="/summary" element={<SummaryRoute />} />
            <Route path="/settings" element={<SettingsRoute />} />
            <Route path="*" element={<Navigate to={`/month/${currentMonth}`} replace />} />
          </Routes>
        </RouteErrorBoundaryReset>
      </main>
      <UpdatePrompt />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter basename={ROUTER_BASENAME}>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
