import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time throws from routed views — most notably
 * `MissingRateError` from `src/domain/fx.ts`, which is thrown deliberately
 * whenever a purchase's currency has no configured exchange rate. Silently
 * converting at a fallback rate would show the user wrong numbers, so the
 * domain throws instead; this boundary is what turns that throw into a
 * recoverable screen instead of an unmounted app.
 *
 * Must be positioned in `App.tsx` so it wraps only the routed content, not
 * the `<nav>` — the whole point is that navigation (in particular the link
 * to Settings, where exchange rates are configured) stays usable.
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  override state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Route failed to render:", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">This view could not be displayed</h1>
        <p className="text-overspend font-money text-sm">{error.message}</p>
        <p className="text-sm text-muted-foreground">
          If this mentions a missing exchange rate, add it under{" "}
          <Link
            to="/settings"
            className="text-[var(--budget-accent)] hover:underline"
            onClick={this.reset}
          >
            Settings
          </Link>{" "}
          — that is where currencies and rates are configured.
        </p>
        <Button variant="outline" onClick={this.reset}>
          Try again
        </Button>
      </div>
    );
  }
}

/**
 * Function-component wrapper so the boundary can be keyed on the current
 * route. Without this, navigating away from the failing route (even to
 * Settings) would leave the boundary's error state stuck, since class
 * components don't re-run render logic on prop/location changes by
 * themselves — remounting via `key` is the simplest correct reset.
 */
export function RouteErrorBoundaryReset({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <RouteErrorBoundary key={location.pathname}>{children}</RouteErrorBoundary>;
}
