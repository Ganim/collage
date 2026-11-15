import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb'
import type { Collection, Photo, SavedSize, SizeFolder } from '../core/types'
import { StorageFullError, type Store, type StoredPhoto } from './store'

interface CollageDB extends DBSchema {
  photos: { key: string; value: StoredPhoto }
  collections: { key: string; value: Collection }
  sizes: { key: string; value: SavedSize }
  folders: { key: string; value: SizeFolder }
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
    const full = isQuota(e) || isQuota(tx.error)
    try {
      tx.abort()
    } catch {
      // already finished or aborted
    }
    if (full) throw new StorageFullError()
    throw e
  }
}

export async function createIdbStore(name = 'collage'): Promise<Store> {
  const db = await openDB<CollageDB>(name, 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('photos', { keyPath: 'id' })
        d.createObjectStore('collections', { keyPath: 'id' })
        d.createObjectStore('sizes', { keyPath: 'id' })
        d.createObjectStore('meta')
      }
      if (oldVersion < 2) d.createObjectStore('folders', { keyPath: 'id' })
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
    importCollection: (photos, collection) =>
      write(db, ['photos', 'collections'], async (tx) => {
        const photoStore = tx.objectStore('photos')
        for (const p of photos) {
          if ((await photoStore.getKey(p.id)) === undefined) await photoStore.put(p)
        }
        await tx.objectStore('collections').put(collection)
      }),
    getCollection: (id) => db.get('collections', id),
    async listCollections() {
      const all = await db.getAll('collections')
      return all.map((c) => ({
        id: c.id,
        name: c.name,
        updatedAt: c.updatedAt,
        frameCount: c.frames.length,
        coverPhotoId:
          c.frames.find((f) => f.layers.length > 0)?.layers[0]?.photoId ?? c.photoIds[0] ?? null,
        photoCount: c.photoIds.length,
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
    deletePhotoIfUnused: (id) =>
      write(db, ['collections', 'photos'], async (tx) => {
        const collections = await tx.objectStore('collections').getAll()
        if (!collections.some((c) => c.photoIds.includes(id)))
          await tx.objectStore('photos').delete(id)
      }),
    listSizes: () => db.getAll('sizes'),
    saveSize: (s) =>
      write(db, ['sizes'], async (tx) => void (await tx.objectStore('sizes').put(s))),
    deleteSize: (id) => write(db, ['sizes'], (tx) => tx.objectStore('sizes').delete(id)),
    listFolders: () => db.getAll('folders'),
    saveFolder: (f) =>
      write(db, ['folders'], async (tx) => void (await tx.objectStore('folders').put(f))),
    deleteFolder: (id) =>
      write(db, ['folders', 'sizes'], async (tx) => {
        await tx.objectStore('folders').delete(id)
        const sizes = tx.objectStore('sizes')
        for (const s of await sizes.getAll()) {
          if (s.folderId === id) {
            delete s.folderId
            await sizes.put(s)
          }
        }
      }),
    duplicateCollection: (id, copy) =>
      write(db, ['collections'], async (tx) => {
        const collections = tx.objectStore('collections')
        if ((await collections.getKey(id)) === undefined) throw new Error('missing')
        await collections.put(copy)
      }),
    getLastCollectionId: () => db.get('meta', LAST_COLLECTION_KEY),
    setLastCollectionId: (id) =>
      write(
        db,
        ['meta'],
        async (tx) => void (await tx.objectStore('meta').put(id, LAST_COLLECTION_KEY)),
      ),
  }
}
