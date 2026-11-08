import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb'
import type { Collection, Photo, SavedSize } from '../core/types'
import { StorageFullError, type Store, type StoredPhoto } from './store'

interface CollageDB extends DBSchema {
  photos: { key: string; value: StoredPhoto }
  collections: { key: string; value: Collection }
  sizes: { key: string; value: SavedSize }
  meta: { key: string; value: string }
}

type Db = IDBPDatabase<CollageDB>
type Stores = StoreNames<CollageDB>[]

const LAST_COLLECTION_KEY = 'lastCollectionId'

function isQuota(e: unknown): boolean {
  return e instanceof Error && e.name === 'QuotaExceededError'
}

/** Runs a read-write transaction; any quota failure, including one raised at commit or abort, becomes StorageFullError. */
async function write<S extends Stores>(
  db: Db,
  stores: S,
  fn: (tx: IDBPTransaction<CollageDB, S, 'readwrite'>) => Promise<void>,
): Promise<void> {
  const tx = db.transaction(stores, 'readwrite')
  tx.done.catch(() => {})
  try {
    await fn(tx)
    await tx.done
  } catch (e) {
    if (isQuota(e) || isQuota(tx.error)) throw new StorageFullError()
    throw e
  }
}

export async function createIdbStore(name = 'collage'): Promise<Store> {
  const db = await openDB<CollageDB>(name, 1, {
    upgrade(d) {
      d.createObjectStore('photos', { keyPath: 'id' })
      d.createObjectStore('collections', { keyPath: 'id' })
      d.createObjectStore('sizes', { keyPath: 'id' })
      d.createObjectStore('meta')
    },
  })

  return {
    putPhoto: (p) =>
      write(db, ['photos'], async (tx) => void (await tx.objectStore('photos').put(p))),
    getPhoto: (id) => db.get('photos', id),
    async getPhotosMeta(ids) {
      const out: Record<string, Photo> = {}
      for (const id of ids) {
        const p = await db.get('photos', id)
        if (p) out[id] = { id: p.id, width: p.width, height: p.height, name: p.name }
      }
      return out
    },
    saveCollection: (c) =>
      write(db, ['collections'], async (tx) => void (await tx.objectStore('collections').put(c))),
    getCollection: (id) => db.get('collections', id),
    async listCollections() {
      const all = await db.getAll('collections')
      return all.map((c) => ({
        id: c.id,
        name: c.name,
        updatedAt: c.updatedAt,
        frameCount: c.frames.length,
      }))
    },
    deleteCollection: (id) =>
      write(db, ['collections', 'photos'], async (tx) => {
        const collections = tx.objectStore('collections')
        const removed = await collections.get(id)
        if (!removed) return
        await collections.delete(id)
        const stillUsed = new Set((await collections.getAll()).flatMap((c) => c.photoIds))
        for (const photoId of removed.photoIds) {
          if (!stillUsed.has(photoId)) await tx.objectStore('photos').delete(photoId)
        }
      }),
    listSizes: () => db.getAll('sizes'),
    saveSize: (s) =>
      write(db, ['sizes'], async (tx) => void (await tx.objectStore('sizes').put(s))),
    deleteSize: (id) => write(db, ['sizes'], (tx) => tx.objectStore('sizes').delete(id)),
    getLastCollectionId: () => db.get('meta', LAST_COLLECTION_KEY),
    setLastCollectionId: (id) =>
      write(
        db,
        ['meta'],
        async (tx) => void (await tx.objectStore('meta').put(id, LAST_COLLECTION_KEY)),
      ),
  }
}
