import { test, expect, describe } from "bun:test";
import { createSnapshotStore, type Persistence } from "./snapshot.ts";
import { createSeedDataset } from "../domain/seed.ts";
import type { Dataset, FxRate } from "../domain/types.ts";

function fakePersistence(initial: Dataset | null = null) {
  const writes: Dataset[] = [];
  let stored = initial;
  const persistence: Persistence = {
    async read() {
      return stored;
    },
    async write(dataset) {
      stored = dataset;
      writes.push(dataset);
    },
  };
  return { persistence, writes, get stored() { return stored; } };
}

describe("load", () => {
  test("seeds and persists on first run", async () => {
    const fake = fakePersistence(null);
    const store = createSnapshotStore(fake.persistence, "2026-09");
    await store.load();
    expect(store.get().posts).toHaveLength(3);
    expect(fake.writes).toHaveLength(1);
    expect(fake.stored!.settings.foldStartMonth).toBe("2026-09");
  });

  test("uses stored data when it exists and does not rewrite it", async () => {
    const existing = createSeedDataset("2025-01");
    const fake = fakePersistence(existing);
    const store = createSnapshotStore(fake.persistence, "2026-09");
    await store.load();
    expect(store.get().settings.foldStartMonth).toBe("2025-01");
    expect(fake.writes).toHaveLength(0);
  });
});

describe("mutate", () => {
  test("applies the change, writes through, and notifies subscribers", async () => {
    const fake = fakePersistence(createSeedDataset("2026-09"));
    const store = createSnapshotStore(fake.persistence, "2026-09");
    await store.load();

    let notifications = 0;
    store.subscribe(() => notifications++);

    await store.mutate((draft) => {
      draft.months[0]!.income = { amount: 20000, currency: "DKK" };
    });

    expect(store.get().months[0]!.income.amount).toBe(20000);
    expect(fake.stored!.months[0]!.income.amount).toBe(20000);
    expect(notifications).toBe(1);
  });

  test("does not mutate the previous snapshot object", async () => {
    const fake = fakePersistence(createSeedDataset("2026-09"));
    const store = createSnapshotStore(fake.persistence, "2026-09");
    await store.load();
    const before = store.get();

    await store.mutate((draft) => {
      draft.posts[0]!.name = "Renamed";
    });

    expect(before.posts[0]!.name).toBe("Video Games");
    expect(store.get().posts[0]!.name).toBe("Renamed");
  });

  test("leaves the snapshot untouched when the write fails", async () => {
    const fake = fakePersistence(createSeedDataset("2026-09"));
    const store = createSnapshotStore(
      { read: fake.persistence.read, write: async () => { throw new Error("disk full"); } },
      "2026-09",
    );
    await store.load();

    await expect(
      store.mutate((draft) => { draft.posts[0]!.name = "Renamed"; }),
    ).rejects.toThrow("disk full");
    expect(store.get().posts[0]!.name).toBe("Video Games");
  });

  test("two concurrent mutate() calls both survive (no lost update)", async () => {
    // Simulate real persistence latency: each write takes ~20ms, so if the
    // two mutations clone concurrently instead of queueing, the second
    // commit silently overwrites the first's change.
    let stored = createSeedDataset("2026-09");
    const persistence: Persistence = {
      async read() {
        return stored;
      },
      async write(dataset) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        stored = dataset;
      },
    };
    const store = createSnapshotStore(persistence, "2026-09");
    await store.load();

    const first = store.mutate((draft) => {
      draft.months[0]!.income = { amount: 20000, currency: "DKK" };
    });
    const second = store.mutate((draft) => {
      draft.posts[0]!.name = "Renamed";
    });
    await Promise.all([first, second]);

    expect(store.get().months[0]!.income.amount).toBe(20000);
    expect(store.get().posts[0]!.name).toBe("Renamed");
    expect(stored.months[0]!.income.amount).toBe(20000);
    expect(stored.posts[0]!.name).toBe("Renamed");
  });

  test("a failing write mid-queue rejects only its own caller and does not wedge later mutations", async () => {
    const fake = fakePersistence(createSeedDataset("2026-09"));
    // The queue processes mutations strictly in order, so failing the
    // SECOND write call (regardless of when each mutate() is invoked)
    // reliably targets the middle mutation below.
    let writeCount = 0;
    const persistence: Persistence = {
      read: fake.persistence.read,
      async write(dataset) {
        writeCount++;
        if (writeCount === 2) throw new Error("disk full");
        await fake.persistence.write(dataset);
      },
    };
    const store = createSnapshotStore(persistence, "2026-09");
    await store.load();

    const okBefore = store.mutate((draft) => {
      draft.months[0]!.income = { amount: 111, currency: "DKK" };
    });
    const failing = store.mutate((draft) => {
      draft.posts[0]!.name = "Should not stick";
    });
    const okAfter = store.mutate((draft) => {
      draft.posts[1]!.name = "Should stick";
    });

    await okBefore;
    await expect(failing).rejects.toThrow("disk full");
    await okAfter;

    expect(store.get().months[0]!.income.amount).toBe(111);
    expect(store.get().posts[0]!.name).not.toBe("Should not stick");
    expect(store.get().posts[1]!.name).toBe("Should stick");
  });
});

test("replace swaps the whole dataset, as JSON import needs", async () => {
  const fake = fakePersistence(createSeedDataset("2026-09"));
  const store = createSnapshotStore(fake.persistence, "2026-09");
  await store.load();

  const incoming = createSeedDataset("2020-01");
  await store.replace(incoming);
  expect(store.get().settings.foldStartMonth).toBe("2020-01");
  expect(fake.stored!.settings.foldStartMonth).toBe("2020-01");
});

describe("reset", () => {
  test("puts back exactly what a first run would have produced", async () => {
    const fake = fakePersistence(null);
    const rates: FxRate[] = [
      { currency: "USD", baseUnitsPerOne: 6.449532, updatedAt: "2026-09-01", source: "manual" },
    ];
    const store = createSnapshotStore(fake.persistence, "2026-09", rates);
    await store.load();

    // Diverge from the seed in every direction a reset has to undo: an added
    // currency, a renamed post, recorded income and a purchase.
    await store.mutate((draft) => {
      draft.currencies.push({ code: "JPY", digits: 0, symbol: "\u00a5", name: "Japanese yen" });
      draft.posts[0]!.name = "Renamed";
      draft.posts.push({
        id: "extra",
        name: "Extra",
        order: 9,
        archived: false,
        currency: "DKK",
        rules: [],
      });
      draft.months[0]!.income = { amount: 28000, currency: "DKK" };
      draft.purchases.push({
        id: "p1",
        date: "2026-09-04",
        description: "Groceries",
        total: { amount: 100, currency: "DKK" },
        splitMode: "percent",
        splits: [{ postId: draft.posts[0]!.id, value: 100, absorbsRemainder: true }],
        schedule: null,
      });
    });

    let notifications = 0;
    store.subscribe(() => notifications++);
    await store.reset();

    const after = store.get();
    // Post IDs are freshly generated, so compare on everything else.
    expect(after.posts.map((p) => p.name)).toEqual([
      "Video Games",
      "Food",
      "Events and Social",
    ]);
    expect(after.currencies.map((c) => c.code)).toEqual(["DKK", "USD", "EUR"]);
    expect(after.fxRates).toEqual(rates);
    expect(after.purchases).toEqual([]);
    expect(after.months).toHaveLength(1);
    expect(after.months[0]!.income.amount).toBe(0);
    expect(notifications).toBe(1);
  });

  test("persists, so the reset survives a reload", async () => {
    const fake = fakePersistence(null);
    const store = createSnapshotStore(fake.persistence, "2026-09");
    await store.load();
    await store.mutate((draft) => {
      draft.posts.length = 0;
    });
    await store.reset();
    expect(fake.stored!.posts).toHaveLength(3);
  });

  test("leaves the snapshot untouched when the write fails", async () => {
    const fake = fakePersistence(createSeedDataset("2026-09"));
    const store = createSnapshotStore(fake.persistence, "2026-09");
    await store.load();
    await store.mutate((draft) => {
      draft.posts[0]!.name = "Renamed";
    });

    fake.persistence.write = async () => {
      throw new Error("quota exceeded");
    };
    await expect(store.reset()).rejects.toThrow("quota exceeded");
    expect(store.get().posts[0]!.name).toBe("Renamed");
  });
});

test("unsubscribe stops notifications", async () => {
  const fake = fakePersistence(createSeedDataset("2026-09"));
  const store = createSnapshotStore(fake.persistence, "2026-09");
  await store.load();

  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  unsubscribe();
  await store.mutate((draft) => { draft.posts[0]!.name = "X"; });
  expect(notifications).toBe(0);
});

test("get before load throws rather than returning empty data", () => {
  const fake = fakePersistence(null);
  const store = createSnapshotStore(fake.persistence, "2026-09");
  expect(() => store.get()).toThrow(/not loaded/i);
});

describe("seed rates", () => {
  test("a first run seeds the rates it was given", async () => {
    const fake = fakePersistence(null);
    const rates = [
      { currency: "EUR" as const, baseUnitsPerOne: 7.474959, updatedAt: "2026-09-01", source: "manual" as const },
    ];
    const store = createSnapshotStore(fake.persistence, "2026-09", rates);
    await store.load();
    expect(store.get().fxRates).toEqual(rates);
  });

  test("an existing dataset is never given seed rates", async () => {
    // Loading stored data must not touch fxRates — the user may have
    // deliberately cleared one, and re-adding it would convert money at a
    // number they never chose.
    const stored = createSeedDataset("2026-01");
    const fake = fakePersistence(stored);
    const store = createSnapshotStore(fake.persistence, "2026-09", [
      { currency: "EUR", baseUnitsPerOne: 7.474959, updatedAt: "2026-09-01", source: "manual" },
    ]);
    await store.load();
    expect(store.get().fxRates).toEqual([]);
  });
});
