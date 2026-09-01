import { test, expect, describe } from "bun:test";
import { migrate, UnsupportedSchemaError } from "./migrations.ts";
import { createSeedDataset, SCHEMA_VERSION } from "../domain/seed.ts";

describe("migrate", () => {
  test("passes a current-version dataset through unchanged", () => {
    const data = createSeedDataset("2026-09");
    expect(migrate(data)).toEqual(data);
  });

  test("rejects a version newer than this build understands", () => {
    const future = { ...createSeedDataset("2026-09"), settings: { baseCurrency: "DKK", foldStartMonth: "2026-09", schemaVersion: SCHEMA_VERSION + 1 } };
    expect(() => migrate(future)).toThrow(UnsupportedSchemaError);
  });

  test("rejects a value that is not an object", () => {
    expect(() => migrate("nope")).toThrow(/not a dataset/i);
    expect(() => migrate(null)).toThrow(/not a dataset/i);
  });

  test("rejects a dataset with no schemaVersion", () => {
    expect(() => migrate({ posts: [] })).toThrow(/schemaVersion/);
  });
});
