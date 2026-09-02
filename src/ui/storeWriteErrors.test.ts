import { test, expect } from "bun:test";
import { Glob } from "bun";

/**
 * A store write is the only step that can fail after the user has committed to
 * an action, and IndexedDB fails for reasons no code can prevent — a full disk,
 * a browser evicting storage, private-mode quotas. An awaited `store.*` call
 * with no handler is an unhandled rejection: the button appears to do nothing
 * and the user is told nothing.
 *
 * `useMutate` exists so most call sites cannot make this mistake. This guards
 * the ones that talk to the store directly. Source-level rather than
 * behavioural, like eventCapture.test.ts, because reproducing it needs a real
 * failing IndexedDB.
 */
test("every awaited store write in the UI is guarded", async () => {
  const offenders: string[] = [];

  for await (const file of new Glob("src/ui/**/*.{ts,tsx}").scan(".")) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    // useMutate IS the guard — it wraps store.mutate in a .catch.
    if (file.endsWith("hooks/useMutate.ts")) continue;
    const source = await Bun.file(file).text();

    for (const match of source.matchAll(/await\s+store\.\w+\(/g)) {
      const enclosing = enclosingFunction(source, match.index);
      if (!/try\s*\{/.test(enclosing) && !/\.catch\(/.test(enclosing)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

/**
 * The body of the nearest `function` declaration containing `index`, found by
 * brace matching forward from its opening brace. Falls back to the whole file
 * when the call is not inside a function declaration at all.
 */
function enclosingFunction(source: string, index: number): string {
  const start = source.lastIndexOf("function ", index);
  if (start === -1) return source;

  let depth = 0;
  let i = source.indexOf("{", start);
  if (i === -1 || i > index) return source;
  const open = i;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return index < i ? source.slice(open, i + 1) : source;
}
