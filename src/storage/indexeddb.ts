import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPObjectStore,
  type IDBPTransaction,
  type StoreNames,
} from 'idb'
import type { Collection, Photo, SavedSize, SizeFolder } from '../core/types'
import {
  StorageFullError,
  type Owner,
  type PhotoReader,
  type Store,
  type StoredPhoto,
  type SyncState,
  type Tombstone,
} from './store'

type MetaValue = string | boolean | Owner

interface CollageDB extends DBSchema {
  photos: { key: string; value: StoredPhoto }
  collections: { key: string; value: Collection }
  sizes: { key: string; value: SavedSize }
  folders: { key: string; value: SizeFolder }
  meta: { key: string; value: MetaValue }
  /** Keyed by collection id. */
  sync: { key: string; value: SyncState }
  /** Keyed by `${kind}:${id}`. */
  tombstones: { key: string; value: Tombstone }
}

type Db = IDBPDatabase<CollageDB>
type Stores = StoreNames<CollageDB>[]
type WriteStore<N extends StoreNames<CollageDB>> = IDBPObjectStore<
  CollageDB,
  Stores,
  N,
  'readwrite'
>
type ReadStore<N extends StoreNames<CollageDB>> = IDBPObjectStore<
  CollageDB,
  Stores,
  N,
  'readonly' | 'readwrite'
>

const LAST_COLLECTION_KEY = 'lastCollectionId'
const OWNER_KEY = 'owner'
const LIBRARY_DIRTY_KEY = 'libraryDirty'

const tombstoneKey = (kind: Tombstone['kind'], id: string) => `${kind}:${id}`

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

async function readOwner(meta: ReadStore<'meta'>): Promise<Owner | undefined> {
  return (await meta.get(OWNER_KEY)) as Owner | undefined
}

async function readStates(sync: ReadStore<'sync'>): Promise<Record<string, SyncState>> {
  const [keys, values] = await Promise.all([sync.getAllKeys(), sync.getAll()])
  return Object.fromEntries(keys.map((k, i) => [k, values[i]!]))
}

async function readPhotosMeta(db: Db, ids: string[]): Promise<Record<string, Photo>> {
  const out: Record<string, Photo> = {}
  for (const id of ids) {
    const p = await db.get('photos', id)
    if (p) out[id] = { id: p.id, width: p.width, height: p.height, name: p.name }
  }
  return out
}

/** Writes a local change: the collection is dirty, and an unowned one goes to the current owner. */
async function putChanged(
  collections: WriteStore<'collections'>,
  sync: WriteStore<'sync'>,
  meta: WriteStore<'meta'>,
  c: Collection,
): Promise<void> {
  await collections.put(c)
  const next: SyncState = { ...((await sync.get(c.id)) ?? { dirty: false }), dirty: true }
  const owner = await readOwner(meta)
  if (next.ownerId === undefined && owner) {
    next.ownerId = owner.id
    next.ownerEmail = owner.email
  }
  await sync.put(next, c.id)
}

async function markLibraryDirty(meta: WriteStore<'meta'>): Promise<void> {
  await meta.put(true, LIBRARY_DIRTY_KEY)
}

async function putTombstone(tombstones: WriteStore<'tombstones'>, t: Tombstone): Promise<void> {
  await tombstones.put(t, tombstoneKey(t.kind, t.id))
}

/** Deletes a collection, its sync state and the photos no other collection uses. */
function removeCollection(db: Db, id: string, leaveTombstone: boolean): Promise<void> {
  return write(db, ['collections', 'photos', 'sync', 'tombstones'], async (tx) => {
    const collections = tx.objectStore('collections')
    const removed = await collections.get(id)
    if (!removed) return
    await collections.delete(id)
    const stillUsed = new Set((await collections.getAll()).flatMap((c) => c.photoIds))
    for (const photoId of removed.photoIds) {
      if (!stillUsed.has(photoId)) await tx.objectStore('photos').delete(photoId)
    }
    const sync = tx.objectStore('sync')
    const state = await sync.get(id)
    // Only an uploaded collection has a Drive file for the sync to trash.
    if (leaveTombstone && state?.remoteFileId !== undefined) {
      await putTombstone(tx.objectStore('tombstones'), {
        kind: 'collection',
        id,
        at: Date.now(),
        remoteFileId: state.remoteFileId,
      })
    }
    await sync.delete(id)
  })
}

export interface IdbStoreEvents {
  /**
   * Another connection (an older tab of the app) keeps the database at an older version, so
   * opening waits until it closes. Opening goes on by itself once it does.
   */
  onBlocked?: () => void
}

export async function createIdbStore(
  name = 'collage',
  { onBlocked }: IdbStoreEvents = {},
): Promise<Store> {
  const db: Db = await openDB<CollageDB>(name, 3, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('photos', { keyPath: 'id' })
        d.createObjectStore('collections', { keyPath: 'id' })
        d.createObjectStore('sizes', { keyPath: 'id' })
        d.createObjectStore('meta')
      }
      if (oldVersion < 2) d.createObjectStore('folders', { keyPath: 'id' })
      if (oldVersion < 3) {
        d.createObjectStore('sync')
        d.createObjectStore('tombstones')
      }
    },
    blocked() {
      onBlocked?.()
    },
    // A newer version of the app wants to upgrade: this connection steps aside. Its next call
    // fails as a lost connection, which reopeningStore answers by opening again.
    blocking() {
      db.close()
    },
  })

  return {
    putPhoto: (p) =>
      write(db, ['photos'], async (tx) => void (await tx.objectStore('photos').put(p))),
    getPhoto: (id) => db.get('photos', id),
    getPhotosMeta: (ids) => readPhotosMeta(db, ids),
    saveCollection: (c) =>
      write(db, ['collections', 'sync', 'meta'], (tx) =>
        putChanged(
          tx.objectStore('collections'),
          tx.objectStore('sync'),
          tx.objectStore('meta'),
          c,
        ),
      ),
    importCollection: (photos, collection) =>
      write(db, ['photos', 'collections', 'sync', 'meta'], async (tx) => {
        const photoStore = tx.objectStore('photos')
        for (const p of photos) {
          if ((await photoStore.getKey(p.id)) === undefined) await photoStore.put(p)
        }
        await putChanged(
          tx.objectStore('collections'),
          tx.objectStore('sync'),
          tx.objectStore('meta'),
          collection,
        )
      }),
    getCollection: (id) => db.get('collections', id),
    async listCollections() {
      const tx = db.transaction(['collections', 'sync', 'meta'])
      const [all, states, owner] = await Promise.all([
        tx.objectStore('collections').getAll(),
        readStates(tx.objectStore('sync')),
        readOwner(tx.objectStore('meta')),
      ])
      return all
        .filter((c) => {
          const ownerId = states[c.id]?.ownerId
          return !owner || ownerId === undefined || ownerId === owner.id
        })
        .map((c) => ({
          id: c.id,
          name: c.name,
          updatedAt: c.updatedAt,
          frameCount: c.frames.length,
          coverPhotoId:
            c.frames.find((f) => f.layers.length > 0)?.layers[0]?.photoId ?? c.photoIds[0] ?? null,
          photoCount: c.photoIds.length,
        }))
    },
    deleteCollection: (id) => removeCollection(db, id, true),
    removeLocalCollection: (id) => removeCollection(db, id, false),
    deletePhotoIfUnused: (id) =>
      write(db, ['collections', 'photos'], async (tx) => {
        const collections = await tx.objectStore('collections').getAll()
        if (!collections.some((c) => c.photoIds.includes(id)))
          await tx.objectStore('photos').delete(id)
      }),
    listSizes: () => db.getAll('sizes'),
    saveSize: (s) =>
      write(db, ['sizes', 'meta'], async (tx) => {
        await tx.objectStore('sizes').put({ ...s, updatedAt: Date.now() })
        await markLibraryDirty(tx.objectStore('meta'))
      }),
    deleteSize: (id) =>
      write(db, ['sizes', 'meta', 'tombstones'], async (tx) => {
        await tx.objectStore('sizes').delete(id)
        await markLibraryDirty(tx.objectStore('meta'))
        await putTombstone(tx.objectStore('tombstones'), { kind: 'size', id, at: Date.now() })
      }),
    listFolders: () => db.getAll('folders'),
    saveFolder: (f) =>
      write(db, ['folders', 'meta'], async (tx) => {
        await tx.objectStore('folders').put({ ...f, updatedAt: Date.now() })
        await markLibraryDirty(tx.objectStore('meta'))
      }),
    deleteFolder: (id) =>
      write(db, ['folders', 'sizes', 'meta', 'tombstones'], async (tx) => {
        const now = Date.now()
        await tx.objectStore('folders').delete(id)
        const sizes = tx.objectStore('sizes')
        for (const s of await sizes.getAll()) {
          if (s.folderId === id) {
            delete s.folderId
            await sizes.put({ ...s, updatedAt: now })
          }
        }
        await markLibraryDirty(tx.objectStore('meta'))
        await putTombstone(tx.objectStore('tombstones'), { kind: 'folder', id, at: now })
      }),
    duplicateCollection: (id, copy) =>
      write(db, ['collections', 'sync', 'meta'], async (tx) => {
        const collections = tx.objectStore('collections')
        if ((await collections.getKey(id)) === undefined) throw new Error('missing')
        await putChanged(collections, tx.objectStore('sync'), tx.objectStore('meta'), copy)
      }),
    async getLastCollectionId() {
      const tx = db.transaction(['meta', 'sync'])
      const meta = tx.objectStore('meta')
      const id = (await meta.get(LAST_COLLECTION_KEY)) as string | undefined
      if (id === undefined) return undefined
      const owner = await readOwner(meta)
      const ownerId = (await tx.objectStore('sync').get(id))?.ownerId
      // Opening another account's work at start would show it to the wrong person.
      return owner && ownerId !== undefined && ownerId !== owner.id ? undefined : id
    },
    setLastCollectionId: (id) =>
      write(
        db,
        ['meta'],
        async (tx) => void (await tx.objectStore('meta').put(id, LAST_COLLECTION_KEY)),
      ),

    setOwner: (owner) =>
      write(db, ['meta'], async (tx) => {
        const meta = tx.objectStore('meta')
        if (owner) await meta.put({ id: owner.id, email: owner.email }, OWNER_KEY)
        else await meta.delete(OWNER_KEY)
      }),
    getSyncStates: () => readStates(db.transaction('sync').store),
    setSyncState: (id, patch) =>
      write(db, ['sync'], async (tx) => {
        const sync = tx.objectStore('sync')
        await sync.put({ ...((await sync.get(id)) ?? { dirty: false }), ...patch }, id)
      }),
    listTombstones: () => db.getAll('tombstones'),
    clearTombstones: (keys) =>
      write(db, ['tombstones'], async (tx) => {
        const tombstones = tx.objectStore('tombstones')
        for (const { kind, id } of keys) await tombstones.delete(tombstoneKey(kind, id))
      }),
    putRemoteCollection: (c, state) =>
      write(db, ['collections', 'sync'], async (tx) => {
        await tx.objectStore('collections').put(c)
        await tx.objectStore('sync').put(state, c.id)
      }),
    isLibraryDirty: async () => (await db.get('meta', LIBRARY_DIRTY_KEY)) === true,
    setLibraryDirty: (v) =>
      write(
        db,
        ['meta'],
        async (tx) => void (await tx.objectStore('meta').put(v, LIBRARY_DIRTY_KEY)),
      ),
    putRemoteLibrary: (sizes, folders) =>
      write(db, ['sizes', 'folders'], async (tx) => {
        const sizeStore = tx.objectStore('sizes')
        const folderStore = tx.objectStore('folders')
        await sizeStore.clear()
        await folderStore.clear()
        for (const s of sizes) await sizeStore.put(s)
        for (const f of folders) await folderStore.put(f)
      }),
    async listOtherOwners() {
      const tx = db.transaction(['collections', 'sync', 'meta'])
      const [keys, states, owner] = await Promise.all([
        tx.objectStore('collections').getAllKeys(),
        readStates(tx.objectStore('sync')),
        readOwner(tx.objectStore('meta')),
      ])
      const others = new Map<string, { id: string; email: string; count: number }>()
      for (const key of keys) {
        const state = states[key]
        if (state?.ownerId === undefined || state.ownerId === owner?.id) continue
        const entry = others.get(state.ownerId) ?? {
          id: state.ownerId,
          email: state.ownerEmail ?? '',
          count: 0,
        }
        entry.count++
        others.set(state.ownerId, entry)
      }
      return [...others.values()]
    },
    claimCollections: (fromOwnerId) =>
      write(db, ['sync', 'meta'], async (tx) => {
        const owner = await readOwner(tx.objectStore('meta'))
        if (!owner) throw new Error('no owner')
        if (fromOwnerId === owner.id) return
        const sync = tx.objectStore('sync')
        for (const [id, state] of Object.entries(await readStates(sync))) {
          // The other account's Drive file is out of reach: upload as a new file.
          if (state.ownerId === fromOwnerId)
            await sync.put({ ownerId: owner.id, ownerEmail: owner.email, dirty: true }, id)
        }
      }),
  }
}

function openForReading(name: string): Promise<Db> {
  // No version: whatever version the app's tabs keep, reading photos works, and it never
  // blocks an upgrade nor fails with VersionError.
  return openDB<CollageDB>(name, undefined, {
    // Runs only when the database does not exist yet. An empty one must not be created here,
    // or the app's own upgrade would skip its stores.
    upgrade(_d, _old, _new, tx) {
      tx.done.catch(() => {})
      tx.abort()
    },
    blocking(_current, _blocked, event) {
      ;(event.target as IDBDatabase).close()
    },
  })
}

/**
 * Opens the database read-only for PDF generation. It steps aside for any upgrade and opens
 * again on its next read. Rejects when the database does not exist.
 */
export async function openPhotoReader(name = 'collage'): Promise<PhotoReader> {
  let db = openForReading(name)
  await db
  const reopen = (used: Promise<Db>) => {
    if (db === used) db = openForReading(name)
    return db
  }
  const withDb = async <T>(fn: (d: Db) => Promise<T>): Promise<T> => {
    const used = db
    // A reopening that failed is tried again on the next read.
    const opened = await used.catch(() => reopen(used))
    try {
      return await fn(opened)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'InvalidStateError')) throw e
      return fn(await reopen(used))
    }
  }
  return {
    getPhoto: (id) => withDb((d) => d.get('photos', id)),
    getPhotosMeta: (ids) => withDb((d) => readPhotosMeta(d, ids)),
  }
}
