/**
 * Screenshots a running page with headless Chrome, and reports whatever the
 * page logged to the console while doing it.
 *
 *   bun scripts/screenshot.ts <url> <out.png> [--w=1280] [--h=900]
 *                             [--wait=1500] [--full] [--click=<selector>]
 *                             [--eval=<js>|--eval-file=<path>] [--dark] [--reload]
 *                             [--profile=<dir>] [--eval-after-file=<path>]
 *
 * Why this exists: ARCHITECTURE.md and TODO.md both say nothing here can run a
 * browser, so appearance has never been verified. Chrome IS available, but its
 * plain `--screenshot` flag fires on the load event — before this app's async
 * IndexedDB read resolves, which captures an empty page. Driving CDP directly
 * lets us wait, act, and read console errors.
 *
 * This does NOT replace a human: it cannot judge feel, and it renders with one
 * font stack on one platform. It does prove a layout exists and is not broken.
 */
const [url, out, ...flags] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: bun scripts/screenshot.ts <url> <out.png> [--w=] [--h=] [--wait=] [--full] [--click=] [--eval=] [--dark]");
  process.exit(2);
}

const flag = (name: string, fallback?: string) =>
  flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const has = (name: string) => flags.includes(`--${name}`);

const width = Number(flag("w", "1280"));
const height = Number(flag("h", "900"));
const waitMs = Number(flag("wait", "1500"));

/**
 * This container's fontconfig resolves EVERY generic family — sans-serif,
 * system-ui, monospace — to Fira Code, a monospace font. Screenshots then show
 * the whole UI monospaced in a way no real user sees, and the last agent to
 * look nearly "fixed" a font bug that did not exist. Applied automatically so
 * nobody has to know that; set FONTCONFIG_FILE yourself to override.
 */
const fontConfig = new URL("./screenshot-fonts.conf", import.meta.url).pathname;
const fontEnv =
  process.env.FONTCONFIG_FILE || !(await Bun.file(fontConfig).exists())
    ? {}
    : { FONTCONFIG_FILE: fontConfig };

const chrome = Bun.spawn(
  [
    process.env.CHROME ?? "google-chrome",
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--remote-debugging-port=0",
    // A fresh profile each run means empty IndexedDB, empty caches and NO
    // registered service worker — which makes anything stateful across loads
    // (an update prompt, a migration, an install) impossible to reproduce.
    ...(flag("profile") ? [`--user-data-dir=${flag("profile")}`] : []),
    `--window-size=${width},${height}`,
    ...(has("dark") ? ["--force-dark-mode", "--enable-features=WebContentsForceDark"] : []),
    "about:blank",
  ],
  { stdout: "ignore", stderr: "pipe", env: { ...process.env, ...fontEnv } },
);

/** Chrome announces its debugging endpoint on stderr, once, at startup. */
async function debuggerUrl(): Promise<string> {
  const reader = chrome.stderr.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const match = /ws:\/\/[^\s]+/.exec(buffer);
    if (match) return match[0];
  }
  throw new Error("Chrome never printed a DevTools endpoint");
}

const browserWs = await debuggerUrl();
const host = new URL(browserWs).host;

// The freshly launched about:blank tab is the one to drive.
const targets = (await (await fetch(`http://${host}/json/list`)).json()) as Array<{
  type: string;
  webSocketDebuggerUrl: string;
}>;
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("No page target to attach to");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let nextId = 0;
const pending = new Map<number, (result: unknown) => void>();
const events: Array<{ method: string; params: any }> = [];

socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id !== undefined) {
    const settle = pending.get(message.id);
    pending.delete(message.id);
    settle?.(message);
  } else {
    events.push({ method: message.method, params: message.params });
  }
};

/** Rejects on a CDP error rather than resolving undefined, which is otherwise
 *  indistinguishable from a command that legitimately returns nothing. */
function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++nextId;
  // Register BEFORE sending: a reply that arrives first would otherwise find
  // no handler and the promise would never settle.
  const reply = new Promise<any>((resolve, reject) => {
    pending.set(id, (message: any) => {
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return reply;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 700,
});
if (has("dark")) {
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  // shadcn's dark palette is class-based (`.dark`), not media-query based, so
  // emulating the media feature alone changes nothing. Add the class too.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `document.addEventListener("DOMContentLoaded", () =>
      document.documentElement.classList.add("dark"));`,
  });
}

await send("Page.navigate", { url });
// Wait for the load event, then for the app's own async work (the IndexedDB
// read, which plain --screenshot never waits for).
const loadDeadline = Date.now() + 20_000;
while (!events.some((e) => e.method === "Page.loadEventFired") && Date.now() < loadDeadline) {
  await Bun.sleep(50);
}
await Bun.sleep(waitMs);

const evalFile = flag("eval-file");
const evalJs = evalFile ? await Bun.file(evalFile).text() : flag("eval");
if (evalJs) {
  const result = await send("Runtime.evaluate", { expression: evalJs, awaitPromise: true });
  console.log("eval:", JSON.stringify(result?.result?.value ?? result?.result?.description ?? null));
  await Bun.sleep(400);
}

// --reload exists for --eval scripts that seed IndexedDB: the app reads its
// dataset once at boot, so it has to boot again to see what was written.
if (has("reload")) {
  events.length = 0;
  await send("Page.navigate", { url });
  const again = Date.now() + 20_000;
  while (!events.some((e) => e.method === "Page.loadEventFired") && Date.now() < again) {
    await Bun.sleep(50);
  }
  await Bun.sleep(waitMs);
}

const clickSelector = flag("click");
if (clickSelector) {
  const clicked = await send("Runtime.evaluate", {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(clickSelector)});
      if (!el) return "not found"; el.click(); return "clicked"; })()`,
  });
  console.log(`click ${clickSelector}: ${clicked?.result?.value}`);
  await Bun.sleep(700);
}

// Runs after the reload, so a flow that ends in a navigation can be observed
// on the other side of it — an update prompt applying itself, a migration.
const evalAfterFile = flag("eval-after-file");
if (evalAfterFile) {
  const source = await Bun.file(evalAfterFile).text();
  const result = await send("Runtime.evaluate", {
    expression: source,
    awaitPromise: true,
  });
  console.log(
    "eval-after:",
    JSON.stringify(result?.result?.value ?? result?.result?.description ?? null),
  );
}

const shot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: has("full"),
});
await Bun.write(out, Buffer.from(shot.data, "base64"));

// Console output is the point of doing this over a plain --screenshot: a page
// that renders blank because of a thrown error looks identical to an empty one.
const logs = events
  .filter((e) => e.method === "Runtime.consoleAPICalled" || e.method === "Log.entryAdded")
  .map((e) =>
    e.method === "Log.entryAdded"
      ? `[${e.params.entry.level}] ${e.params.entry.text}`
      : `[${e.params.type}] ${(e.params.args ?? [])
          .map((a: any) => a.value ?? a.description ?? a.type)
          .join(" ")}`,
  );
const exceptions = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => `[uncaught] ${e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text}`);

console.log(`wrote ${out} (${width}x${height})`);
for (const line of [...exceptions, ...logs]) console.log("  " + line);
if (exceptions.length === 0 && logs.length === 0) console.log("  (console clean)");

socket.close();
chrome.kill();
await chrome.exited;
