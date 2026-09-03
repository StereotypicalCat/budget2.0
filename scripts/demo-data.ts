/**
 * Writes a browser script that seeds a synthetic dataset into IndexedDB, for
 * screenshots and for poking at the app with realistic data.
 *
 *   bun scripts/demo-data.ts /tmp/seed.js
 *   bun scripts/screenshot.ts http://localhost:3000/month/2026-09 /tmp/shot.png \
 *     --eval-file=/tmp/seed.js --reload
 *
 * `--reload` is not optional: the app reads its dataset once at boot, so it has
 * to boot again to see what was written. Chrome also starts from a fresh
 * profile on every run unless you pass --profile, so without this every
 * screenshot shows an app full of zeros.
 *
 * The data is visibly synthetic on purpose. docs/PRODUCT.md: the owner's real budget
 * never leaves their browser, so it is never available as example material, and
 * illustrative data must not pretend to be real.
 */
import { createSeedDataset } from "../src/domain/seed.ts";
import * as actions from "../src/store/actions.ts";
import { FALLBACK_FX_RATES } from "../src/store/bakedRates.ts";

// Visibly synthetic, per docs/PRODUCT.md: the owner's real budget must never be
// used as example material, and illustrative data must not look real.
const d = createSeedDataset("2026-01", FALLBACK_FX_RATES);
const [games, food, social] = d.posts as [typeof d.posts[0], typeof d.posts[0], typeof d.posts[0]];
const rent = actions.addPost(d, "Rent", "DKK");
const transport = actions.addPost(d, "Transport", "DKK");
const savings = actions.addPost(d, "Savings", "DKK");

for (let m = 1; m <= 9; m++) {
  const id = `2026-${String(m).padStart(2, "0")}`;
  actions.setIncome(d, id, { amount: m === 7 ? 24500 : 28000, currency: "DKK" });
}

actions.setRuleFrom(d, rent.id, "2026-01", { kind: "fixed", amount: { amount: 8200, currency: "DKK" } });
actions.setRuleFrom(d, food.id, "2026-01", { kind: "percentOfIncome", percent: 12 });
actions.setRuleFrom(d, food.id, "2026-06", { kind: "percentOfIncome", percent: 15 });
actions.setRuleFrom(d, games.id, "2026-01", { kind: "fixed", amount: { amount: 600, currency: "DKK" } });
actions.setRuleFrom(d, social.id, "2026-01", { kind: "percentOfIncome", percent: 6 });
actions.setRuleFrom(d, transport.id, "2026-01", { kind: "fixed", amount: { amount: 1100, currency: "DKK" } });
actions.setRuleFrom(d, savings.id, "2026-03", { kind: "percentOfIncome", percent: 10 });
actions.setRuleOverride(d, "2026-09", social.id, { kind: "fixed", amount: { amount: 2400, currency: "DKK" } });

// Recurring costs: bills that project their own expected charges, shown as a
// second balance ("Projected") beside the allocation-rule figures above. All
// three recurrence kinds and both anchorings appear, so the screenshots show
// every combination at once.
const wowSub = actions.addRecurringCost(d, {
  name: "World of Warcraft",
  archived: false,
  amount: { amount: 13, currency: "USD" },
  startDate: "2026-06-05",
  recurrence: { kind: "everyNDays", n: 28 },
  anchoring: "calendar",
  splitMode: "percent",
  splits: [{ postId: games.id, value: 100, absorbsRemainder: true }],
});
actions.addRecurringCost(d, {
  name: "Rent",
  archived: false,
  amount: { amount: 8200, currency: "DKK" },
  startDate: "2026-06",
  recurrence: { kind: "everyNMonths", n: 1 },
  anchoring: "calendar",
  splitMode: "percent",
  splits: [{ postId: rent.id, value: 100, absorbsRemainder: true }],
});
actions.addRecurringCost(d, {
  name: "Veg box",
  archived: false,
  amount: { amount: 175, currency: "DKK" },
  startDate: "2026-06-06",
  recurrence: { kind: "everyNWeeks", n: 2, weekday: 6 },
  anchoring: "calendar",
  splitMode: "percent",
  splits: [{ postId: food.id, value: 100, absorbsRemainder: true }],
});
// Rebases on the actual charge date rather than the calendar, so an
// off-schedule payment moves the whole series — the phone-bill behaviour.
actions.addRecurringCost(d, {
  name: "Car insurance",
  archived: false,
  amount: { amount: 349, currency: "DKK" },
  startDate: "2026-08-14",
  recurrence: { kind: "everyNDays", n: 30 },
  anchoring: "lastCharge",
  splitMode: "percent",
  splits: [{ postId: transport.id, value: 100, absorbsRemainder: true }],
});

// One confirmed occurrence, so a screenshot shows both states at once: the
// expected band lists what is still due, and the fold's two tracks have
// already reconverged for this one.
actions.confirmOccurrence(d, wowSub.id, "2026-06-05", { date: "2026-06-05" });

const buy = (date: string, description: string, amount: number, currency: "DKK" | "EUR" | "USD", postId: string, note?: string) =>
  actions.addPurchase(d, {
    date, description, note,
    total: { amount, currency },
    splitMode: "percent",
    splits: [{ postId, value: 100, absorbsRemainder: true }],
    schedule: null,
  });

for (let m = 1; m <= 9; m++) {
  const mm = String(m).padStart(2, "0");
  buy(`2026-${mm}-01`, "Rent", 8200, "DKK", rent.id);
  buy(`2026-${mm}-04`, "Groceries", 1180 + m * 37, "DKK", food.id);
  buy(`2026-${mm}-18`, "Groceries", 1420 - m * 12, "DKK", food.id);
  buy(`2026-${mm}-06`, "Commuter pass", 1100, "DKK", transport.id);
}
buy("2026-09-03", "Coffee with the team", 184, "DKK", social.id);
buy("2026-09-07", "Board game night", 465, "DKK", social.id, "split the taxi");
buy("2026-09-12", "Indie bundle", 27.5, "EUR", games.id, "sale");
buy("2026-09-15", "Birthday dinner", 1850, "DKK", social.id);
buy("2026-08-22", "Headphones", 89.99, "USD", games.id);

// A split across posts, and a purchase spread over months. Both compose.
actions.addPurchase(d, {
  date: "2026-09-09", description: "Weekend away", note: "food + social",
  total: { amount: 2600, currency: "DKK" }, splitMode: "percent",
  splits: [
    { postId: social.id, value: 65, absorbsRemainder: true },
    { postId: food.id, value: 35, absorbsRemainder: false },
  ],
  schedule: null,
});
actions.addPurchase(d, {
  date: "2026-08-14", description: "Bike", note: "paid over 4 months",
  total: { amount: 6400, currency: "DKK" }, splitMode: "percent",
  splits: [{ postId: transport.id, value: 100, absorbsRemainder: true }],
  schedule: { slices: [
    { month: "2026-08", amount: { amount: 1600, currency: "DKK" } },
    { month: "2026-09", amount: { amount: 1600, currency: "DKK" } },
    { month: "2026-10", amount: { amount: 1600, currency: "DKK" } },
    { month: "2026-11", amount: { amount: 1600, currency: "DKK" } },
  ] },
});

await Bun.write(
  process.argv[2]!,
  `(async () => {
  const data = ${JSON.stringify(d)};
  await new Promise((resolve, reject) => {
    const open = indexedDB.open("budget2", 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(data, "dataset");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });
  return "seeded " + data.posts.length + " posts, " + data.purchases.length + " purchases";
})()`,
);
console.log("wrote eval script to", process.argv[2]);
