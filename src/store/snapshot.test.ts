import { test, expect, describe } from "bun:test";
import { createSnapshotStore, type Persistence } from "./snapshot.ts";
import { createSeedDataset } from "../domain/seed.ts";
import type { Dataset } from "../domain/types.ts";

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
