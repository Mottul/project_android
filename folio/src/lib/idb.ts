/**
 * A very small IndexedDB wrapper.
 *
 * Folio stores four different things locally — the library index, the file
 * handles that produced it, the marks made on a document and its thumbnail —
 * and none of that justifies a dependency. What it does justify is one place
 * where the schema is written down and where every request turns into a
 * promise.
 */

const DB_NAME = 'folio'
const DB_VERSION = 1

export const STORE = {
  /** Library entries: one per document, see store/library.ts. */
  docs: 'docs',
  /** Picked folders and files, so the library survives a restart. */
  sources: 'sources',
  /** File contents for documents that have no re-openable handle. */
  blobs: 'blobs',
  /** Highlights, notes, ink, text boxes and text replacements. */
  marks: 'marks',
  /** Cover images, generated on import. */
  thumbs: 'thumbs',
  /** Free-form key/value settings. */
  settings: 'settings',
} as const

export type StoreName = (typeof STORE)[keyof typeof STORE]

let dbPromise: Promise<IDBDatabase> | null = null

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(STORE.docs)) {
        const docs = db.createObjectStore(STORE.docs, { keyPath: 'id' })
        docs.createIndex('openedAt', 'openedAt')
        docs.createIndex('addedAt', 'addedAt')
        docs.createIndex('sourceId', 'sourceId')
      }
      if (!db.objectStoreNames.contains(STORE.sources)) {
        db.createObjectStore(STORE.sources, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE.blobs)) {
        db.createObjectStore(STORE.blobs)
      }
      if (!db.objectStoreNames.contains(STORE.marks)) {
        const marks = db.createObjectStore(STORE.marks, { keyPath: 'id' })
        marks.createIndex('docId', 'docId')
      }
      if (!db.objectStoreNames.contains(STORE.thumbs)) {
        db.createObjectStore(STORE.thumbs)
      }
      if (!db.objectStoreNames.contains(STORE.settings)) {
        db.createObjectStore(STORE.settings)
      }
    }

    request.onsuccess = () => {
      const db = request.result
      // A second tab running a newer version must not be blocked by this one.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(new Error('Die Datenbank ist von einem anderen Tab belegt.'))
  })

  return dbPromise
}

async function withStore<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest | IDBRequest[] | void,
): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(name, mode)
    const result = run(tx.objectStore(name))
    let value: unknown

    if (Array.isArray(result)) {
      const values: unknown[] = []
      result.forEach((request, index) => {
        request.onsuccess = () => {
          values[index] = request.result
        }
      })
      value = values
    } else if (result) {
      result.onsuccess = () => {
        value = result.result
      }
    }

    tx.oncomplete = () => resolve(value as T)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return withStore<T | undefined>(store, 'readonly', (s) => s.get(key))
}

export function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return withStore<T[]>(store, 'readonly', (s) => s.getAll())
}

export function idbGetAllByIndex<T>(
  store: StoreName,
  index: string,
  key: IDBValidKey,
): Promise<T[]> {
  return withStore<T[]>(store, 'readonly', (s) => s.index(index).getAll(key))
}

export function idbPut(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  return withStore<void>(store, 'readwrite', (s) => {
    key === undefined ? s.put(value) : s.put(value, key)
  })
}

export function idbPutMany(store: StoreName, values: unknown[]): Promise<void> {
  return withStore<void>(store, 'readwrite', (s) => {
    for (const value of values) s.put(value)
  })
}

export function idbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  return withStore<void>(store, 'readwrite', (s) => {
    s.delete(key)
  })
}

export function idbDeleteMany(store: StoreName, keys: IDBValidKey[]): Promise<void> {
  return withStore<void>(store, 'readwrite', (s) => {
    for (const key of keys) s.delete(key)
  })
}

export function idbClear(store: StoreName): Promise<void> {
  return withStore<void>(store, 'readwrite', (s) => {
    s.clear()
  })
}

/** How much the browser lets Folio keep, and how much is already used. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}

/**
 * Asks the browser not to evict Folio's data when disk gets tight. Chromium
 * grants this silently for installed apps; elsewhere it may prompt or refuse,
 * and a refusal is not an error worth surfacing.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
