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
import { ThemeToggle } from "./components/ThemeToggle.tsx";

/**
 * One nav item. The active route is marked with weight and an accent
 * underline rather than colour alone, so it does not depend on colour vision,
 * and the underline is drawn on a fixed-height pseudo-row so switching tabs
 * never shifts the header's layout.
 */
function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "relative rounded-md px-2.5 py-1.5 transition-colors",
          "after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:rounded-full",
          isActive
            ? "font-semibold text-budget-ink after:bg-budget-accent"
            : "text-budget-ink-muted hover:text-budget-ink hover:bg-accent after:bg-transparent",
        ].join(" ")
      }
    >
      {children}
    </NavLink>
  );
}

export function AppRoutes() {
  const year = currentMonth.slice(0, 4);
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sticky because the month view is long and the nav is how you leave
          it. Translucent with a blur so the paper ground still reads as one
          continuous sheet scrolling underneath. */}
      <header className="sticky top-0 z-30 border-b border-budget-rule bg-budget-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2.5 sm:px-6">
          <span className="mr-3 hidden text-sm font-semibold tracking-tight text-budget-ink sm:block">
            Budget<span className="text-budget-accent">&nbsp;2.0</span>
          </span>
          <nav className="flex items-center gap-1 text-sm">
            <NavItem to={`/month/${currentMonth}`}>Month</NavItem>
            <NavItem to={`/year/${year}`}>Year</NavItem>
            <NavItem to="/summary">Summary</NavItem>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NavItem to="/settings">Settings</NavItem>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
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
