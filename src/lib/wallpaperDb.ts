import type { WallpaperItem } from "./types";

const DB_NAME = "tab-wallpapers";
const DB_VERSION = 1;
const WALLPAPER_STORE = "wallpapers";
const BLOB_STORE = "blobs";

type StoredBlob = {
  id: string;
  blob: Blob;
};

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WALLPAPER_STORE)) {
        db.createObjectStore(WALLPAPER_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: "id" });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
}

function tx<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = run(transaction.objectStore(storeName));
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      })
  );
}

export async function listWallpapers(): Promise<WallpaperItem[]> {
  const items = await tx<WallpaperItem[]>(WALLPAPER_STORE, "readonly", (store) => store.getAll());
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveWallpaper(item: WallpaperItem, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([WALLPAPER_STORE, BLOB_STORE], "readwrite");
    transaction.objectStore(WALLPAPER_STORE).put(item);
    transaction.objectStore(BLOB_STORE).put({ id: item.blobId, blob } satisfies StoredBlob);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

export async function updateWallpaper(item: WallpaperItem): Promise<void> {
  await tx<IDBValidKey>(WALLPAPER_STORE, "readwrite", (store) => store.put(item));
}

export async function deleteWallpaper(item: WallpaperItem): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([WALLPAPER_STORE, BLOB_STORE], "readwrite");
    transaction.objectStore(WALLPAPER_STORE).delete(item.id);
    transaction.objectStore(BLOB_STORE).delete(item.blobId);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

export async function getWallpaperBlob(blobId: string): Promise<Blob | undefined> {
  const stored = await tx<StoredBlob | undefined>(BLOB_STORE, "readonly", (store) => store.get(blobId));
  return stored?.blob;
}

export async function getWallpaperStorageSummary(): Promise<{ count: number; bytes: number; missing: number }> {
  const items = await listWallpapers();
  let bytes = 0;
  let missing = 0;
  for (const item of items) {
    const blob = await getWallpaperBlob(item.blobId);
    if (blob) bytes += blob.size;
    else missing += 1;
  }
  return { count: items.length, bytes, missing };
}

export async function deleteBrokenWallpapers(): Promise<number> {
  const items = await listWallpapers();
  let deleted = 0;
  for (const item of items) {
    const blob = await getWallpaperBlob(item.blobId);
    if (!blob) {
      await deleteWallpaper(item);
      deleted += 1;
    }
  }
  return deleted;
}
