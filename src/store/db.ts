import type { Dataset } from "../domain/types.ts";
import { migrate } from "./migrations.ts";

export const DB_NAME = "budget2";
export const STORE_NAME = "state";
export const RECORD_KEY = "dataset";

/** IndexedDB's own version. Bumped only when the object stores change. */
const IDB_VERSION = 1;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, IDB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export async function readDataset(): Promise<Dataset | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const raw = await request(tx.objectStore(STORE_NAME).get(RECORD_KEY));
    return raw === undefined ? null : migrate(raw);
  } finally {
    db.close();
  }
}

/** Writes the whole dataset in one transaction, so a write can never tear. */
export async function writeDataset(dataset: Dataset): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    await request(tx.objectStore(STORE_NAME).put(dataset, RECORD_KEY));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
