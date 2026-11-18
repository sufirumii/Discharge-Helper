/**
 * idb — tiny IndexedDB helper (no dependency). Records live in the "records"
 * store as AES-GCM envelopes (see session.ts); the auto-generated device key
 * lives in the separate "keys" store so a raw database dump never shows
 * plaintext medicine lists.
 */

import { encryptJson, decryptJson, type Envelope } from "./crypto";
import type { BeforeMed, Lang, MealAnchors } from "@/engine/types";

const DB_NAME = "discharge-helper";
const DB_VERSION = 2;

export const STORES = ["records", "keys"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb: open failed"));
  });
  return dbPromise;
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb: put failed"));
  });
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error("idb: get failed"));
  });
}

export async function idbDel(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb: delete failed"));
  });
}

export async function idbClear(store: StoreName): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb: clear failed"));
  });
}

export async function eraseEverything(): Promise<void> {
  // 1. IndexedDB (docs, plans, settings).
  try {
    await Promise.all(STORES.map((s: string) => indexedDB.deleteDatabase(`discharge-helper-store-${s}`)));
    await indexedDB.deleteDatabase("discharge-helper");
  } catch {
    /* best effort */
  }

  // 2. All Cache Storage entries.
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    /* best effort */
  }

  // 3. Service worker (unregister; its caches were just deleted).
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* best effort */
  }

  // 4. localStorage / sessionStorage (settings may mirror there).
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* best effort */
  }
}

export interface PersistedDoc {
  id: string;
  kind: "paste" | "pdf-text" | "txt" | "photo";
  label: string;
  text?: string;
}

export interface PersistedSession {
  docs: PersistedDoc[];
  before: BeforeMed[];
  language: Lang;
  anchors: MealAnchors;
  daysToBuyDefault: number;
  savedAt: number;
}

const KEY_ID = "device-key";
const RECORD_ID = "session";

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getDeviceKey(): Promise<string> {
  const existing = await idbGet<string>("keys", KEY_ID);
  if (existing) return existing;
  const key = randomKey();
  await idbSet("keys", KEY_ID, key);
  return key;
}

export async function saveSession(session: PersistedSession): Promise<void> {
  const key = await getDeviceKey();
  const envelope = await encryptJson(session, key);
  await idbSet("records", RECORD_ID, envelope);
}

export async function loadSession(): Promise<PersistedSession | null> {
  const envelope = await idbGet<Envelope>("records", RECORD_ID);
  if (!envelope) return null;
  try {
    const key = await getDeviceKey();
    const value = (await decryptJson(envelope, key)) as PersistedSession;
    if (!value || typeof value !== "object" || !Array.isArray(value.docs)) return null;
    return value;
  } catch {
    // Wrong or missing key: the session cannot be decrypted; treat as absent.
    return null;
  }
}
