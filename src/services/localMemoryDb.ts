export const LOCAL_MEMORY_DB_NAME = "scarpe-local-memory";
export const LOCAL_MEMORY_DB_VERSION = 1;

export const LOCAL_MEMORY_STORES = {
  crawlUrls: "crawl_urls",
  scraiLessons: "scrai_lessons",
  actionHistory: "action_history",
} as const;

type StoreName = (typeof LOCAL_MEMORY_STORES)[keyof typeof LOCAL_MEMORY_STORES];
let databasePromise: Promise<IDBDatabase> | null = null;

export function openLocalMemoryDb(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser context."));
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_MEMORY_DB_NAME, LOCAL_MEMORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_MEMORY_STORES.crawlUrls)) {
        const store = db.createObjectStore(LOCAL_MEMORY_STORES.crawlUrls, { keyPath: "canonicalUrl" });
        store.createIndex("domain", "domain", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("lastCrawledAt", "lastCrawledAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(LOCAL_MEMORY_STORES.scraiLessons)) {
        const store = db.createObjectStore(LOCAL_MEMORY_STORES.scraiLessons, { keyPath: "lessonKey" });
        store.createIndex("reviewStatus", "review.status", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(LOCAL_MEMORY_STORES.actionHistory)) {
        const store = db.createObjectStore(LOCAL_MEMORY_STORES.actionHistory, { keyPath: "id" });
        store.createIndex("lessonKey", "lessonKey", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Unable to open local memory database."));
    };
  });

  return databasePromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export async function getLocalRecord<T>(storeName: StoreName, key: IDBValidKey): Promise<T | null> {
  const db = await openLocalMemoryDb();
  const result = await requestToPromise(db.transaction(storeName, "readonly").objectStore(storeName).get(key));
  return (result as T | undefined) ?? null;
}

export async function getAllLocalRecords<T>(storeName: StoreName): Promise<T[]> {
  const db = await openLocalMemoryDb();
  return requestToPromise(db.transaction(storeName, "readonly").objectStore(storeName).getAll()) as Promise<T[]>;
}

export async function putLocalRecord<T>(storeName: StoreName, value: T): Promise<void> {
  const db = await openLocalMemoryDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write was aborted."));
  });
}

export async function clearLocalStore(storeName: StoreName): Promise<void> {
  const db = await openLocalMemoryDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB clear was aborted."));
  });
}
