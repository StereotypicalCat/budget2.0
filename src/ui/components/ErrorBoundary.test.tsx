import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Bun can run multiple test files in one process, and registerSw.test.ts
// registers happy-dom globally too — guard so both files can run together.
if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}

// Silences React's "environment not configured to support act(...)" warning;
// this file drives React purely through explicit `act()` calls below.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { test, expect, afterEach } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Link, MemoryRouter, useLocation } from "react-router";
import { RouteErrorBoundary, RouteErrorBoundaryReset } from "./ErrorBoundary.tsx";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(children: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(children);
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function Thrower(): never {
  throw new Error("No exchange rate configured for EUR");
}

function Fine() {
  return <div>all good</div>;
}

test("a throwing child renders the fallback including the thrown message", () => {
  const el = mount(
    <MemoryRouter>
      <RouteErrorBoundary>
        <Thrower />
      </RouteErrorBoundary>
    </MemoryRouter>,
  );

  expect(el.textContent).toContain("This view could not be displayed");
  expect(el.textContent).toContain("No exchange rate configured for EUR");
  // The way back to Settings must still be present.
  const link = el.querySelector("a[href*='/settings']");
  expect(link).not.toBeNull();
  // "Try again" control is present to retry without a full reload.
  expect(el.textContent).toContain("Try again");
});

test("a non-throwing child renders normally", () => {
  const el = mount(
    <MemoryRouter>
      <RouteErrorBoundary>
        <Fine />
      </RouteErrorBoundary>
    </MemoryRouter>,
  );

  expect(el.textContent).toContain("all good");
  expect(el.textContent).not.toContain("could not be displayed");
});

function View() {
  const location = useLocation();
  return (
    <RouteErrorBoundaryReset>
      {location.pathname === "/a" ? <Thrower /> : <Fine />}
    </RouteErrorBoundaryReset>
  );
}

test("RouteErrorBoundaryReset resets the error state when the route changes", () => {
  const el = mount(
    <MemoryRouter initialEntries={["/a"]}>
      <Link to="/b">go to settings</Link>
      <View />
    </MemoryRouter>,
  );
  expect(el.textContent).toContain("No exchange rate configured for EUR");

  // A real navigation (e.g. following the boundary's Settings link) changes
  // the route; the boundary is keyed on location.pathname, so it should
  // remount with a clean error state instead of staying stuck.
  const link = el.querySelector("a");
  expect(link).not.toBeNull();
  act(() => {
    link!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  expect(el.textContent).toContain("all good");
  expect(el.textContent).not.toContain("could not be displayed");
});
