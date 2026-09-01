import { test, expect } from "bun:test";
import { Glob } from "bun";

/**
 * Regression guard for a bug that froze the "Income this month" field at 0.
 *
 * `mutate()` defers its callback behind the store's serialization queue and an
 * IndexedDB write. React re-renders and resets a controlled input's DOM value
 * back to the last committed value long before that callback runs, so a handler
 * that reads `event.target.value` INSIDE the callback reads the reset value —
 * committing 0 forever, while typing appeared to do nothing.
 *
 * The value must be captured synchronously in the handler, then passed in.
 * This scans source rather than behaviour because the trigger is real-browser
 * render timing that happy-dom does not reproduce.
 */
test("no handler reads event.target.value inside a deferred mutate() callback", async () => {
  const offenders: string[] = [];

  for await (const file of new Glob("src/ui/**/*.tsx").scan(".")) {
    const source = await Bun.file(file).text();
    // Find each mutate( call and inspect its callback body.
    const re = /mutate\(\s*\(?\s*(?:draft|data)\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      // Walk to the end of the mutate(...) call by matching parentheses.
      let depth = 0;
      let i = source.indexOf("(", match.index);
      const start = i;
      for (; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") { depth--; if (depth === 0) break; }
      }
      const body = source.slice(start, i + 1);
      if (/\b(?:event|e)\.target\.value/.test(body)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});
