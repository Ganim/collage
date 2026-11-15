// @vitest-environment node
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Collection } from '../core/types'
import { exportBundle, importBundle } from './bundle'
import { createIdbStore, openPhotoReader } from './indexeddb'
import { StorageFullError, type Store, type StoredPhoto } from './store'

const ID = {
  a: createHash('sha256').update('orig-a').digest('hex'),
  b: createHash('sha256').update('orig-b').digest('hex'),
}
type Key = keyof typeof ID

function photo(key: Key): StoredPhoto {
  const id = ID[key]
  return {
    id,
    width: 400,
    height: 300,
    name: `${id.slice(0, 4)}.jpg`,
    original: new Blob([`orig-${key}`], { type: 'image/png' }),
    preview: new Blob([`prev-${key}`], { type: 'image/jpeg' }),
    thumb: new Blob([`thumb-${key}`], { type: 'image/jpeg' }),
  }
}

function collection(id: string, photoIds: string[]): Collection {
  return {
    schemaVersion: 1,
    id,
    name: `Colecao ${id}`,
    photoIds,
    frames: [
      {
        id: 'f1',
        widthMm: 30,
        heightMm: 40,
        layers: photoIds.map((photoId, i) => ({
          id: `l${i}`,
          photoId,
          cx: 0.5,
          cy: 0.5,
          widthFrac: 1,
          rotationDeg: 0,
        })),
      },
    ],
    paper: { widthMm: 210, heightMm: 297, marginMm: 5, gapMm: 2 },
    updatedAt: 1000,
  }
}

let dbCount = 0
let store: Store
beforeEach(async () => {
  store = await createIdbStore(`test-${dbCount++}`)
})
afterEach(() => vi.restoreAllMocks())

describe('store', () => {
  it('saves and reads back a collection; the list carries frameCount', async () => {
    const c = collection('c1', [ID.a])
    await store.saveCollection(c)
    expect(await store.getCollection('c1')).toEqual(c)
    expect(await store.listCollections()).toEqual([
      {
        id: 'c1',
        name: c.name,
        updatedAt: 1000,
        frameCount: 1,
        coverPhotoId: ID.a,
        photoCount: 1,
      },
    ])
  })

  it('migrates a v1 database keeping sizes', async () => {
    const saved = { id: 's1', name: '3x4', widthMm: 30, heightMm: 40 }
    const old = await openDB('t-v1', 1, {
      upgrade(d) {
        d.createObjectStore('photos', { keyPath: 'id' })
        d.createObjectStore('collections', { keyPath: 'id' })
        d.createObjectStore('sizes', { keyPath: 'id' })
        d.createObjectStore('meta')
      },
    })
    const c = collection('c1', [ID.a])
    await old.put('sizes', saved)
    await old.put('photos', photo('a'))
    await old.put('collections', c)
    await old.put('meta', 'c1', 'lastCollectionId')
    old.close()
    const migrated = await createIdbStore('t-v1')
    expect(await migrated.listSizes()).toEqual([saved])
    expect(await migrated.listFolders()).toEqual([])
    expect(await migrated.getCollection('c1')).toEqual(c)
    expect(await migrated.getPhotosMeta([ID.a])).toEqual({
      [ID.a]: { id: ID.a, width: 400, height: 300, name: photo('a').name },
    })
    expect(await (await migrated.getPhoto(ID.a))?.original.text()).toBe('orig-a')
    expect(await migrated.getLastCollectionId()).toBe('c1')
  })

  it('closes its connection when a newer version needs the database', async () => {
    const name = 't-blocking'
    const current = await createIdbStore(name)
    const newer = await openDB(name, 4)
    expect(newer.version).toBe(4)
    newer.close()
    await expect(current.listSizes()).rejects.toMatchObject({ name: 'InvalidStateError' })
  })

  it('says when an older open connection blocks the upgrade, then opens once it closes', async () => {
    const name = 't-blocked'
    const old = await openDB(name, 1, {
      upgrade(d) {
        d.createObjectStore('photos', { keyPath: 'id' })
        d.createObjectStore('collections', { keyPath: 'id' })
        d.createObjectStore('sizes', { keyPath: 'id' })
        d.createObjectStore('meta')
      },
    })
    const onBlocked = vi.fn()
    const opening = createIdbStore(name, { onBlocked })
    await vi.waitFor(() => expect(onBlocked).toHaveBeenCalled())
    old.close()
    const opened = await opening
    expect(await opened.listFolders()).toEqual([])
  })

  it('deleteFolder clears folderId of its sizes', async () => {
    await store.saveFolder({ id: 'f1', name: 'Pasta', createdAt: 1 })
    await store.saveSize({ id: 'a', name: 'A', widthMm: 30, heightMm: 40, folderId: 'f1' })
    await store.saveSize({ id: 'b', name: 'B', widthMm: 20, heightMm: 30 })
    expect(await store.listFolders()).toHaveLength(1)
    await store.deleteFolder('f1')
    expect(await store.listFolders()).toEqual([])
    const sizes = await store.listSizes()
    expect(sizes.find((s) => s.id === 'a')?.folderId).toBeUndefined()
    expect(sizes.find((s) => s.id === 'b')).toEqual({
      id: 'b',
      name: 'B',
      widthMm: 20,
      heightMm: 30,
      updatedAt: expect.any(Number),
    })
  })

  it('summary has a cover', async () => {
    const c = collection('c1', [ID.a, ID.b])
    c.frames = [
      { id: 'f1', widthMm: 30, heightMm: 40, layers: [] },
      { id: 'f2', widthMm: 30, heightMm: 40, layers: collection('x', [ID.b]).frames[0]!.layers },
    ]
    await store.saveCollection(c)
    let [s] = await store.listCollections()
    expect(s).toMatchObject({ coverPhotoId: ID.b, photoCount: 2 })
    c.frames = [{ id: 'f1', widthMm: 30, heightMm: 40, layers: [] }]
    await store.saveCollection(c)
    ;[s] = await store.listCollections()
    expect(s!.coverPhotoId).toBe(ID.a)
    c.photoIds = []
    await store.saveCollection(c)
    ;[s] = await store.listCollections()
    expect(s).toMatchObject({ coverPhotoId: null, photoCount: 0 })
  })

  it('duplicateCollection writes the copy', async () => {
    await store.putPhoto(photo('a'))
    await store.saveCollection(collection('c1', [ID.a]))
    const copy = { ...collection('c2', [ID.a]), name: 'Colecao c1 (copia)' }
    await store.duplicateCollection('c1', copy)
    expect(await store.getCollection('c2')).toEqual(copy)
    await expect(store.duplicateCollection('nope', copy)).rejects.toThrow('missing')
  })

  it("deleting the original keeps the copy's photos", async () => {
    await store.putPhoto(photo('a'))
    await store.saveCollection(collection('c1', [ID.a]))
    await store.duplicateCollection('c1', collection('c2', [ID.a]))
    await store.deleteCollection('c1')
    expect(await store.getPhoto(ID.a)).toBeDefined()
  })

  it('stores photos with blobs and returns metadata without them', async () => {
    await store.putPhoto(photo('a'))
    const got = await store.getPhoto(ID.a)
    expect(await got!.original.text()).toBe('orig-a')
    expect(await store.getPhotosMeta([ID.a, 'z'.repeat(64)])).toEqual({
      [ID.a]: { id: ID.a, width: 400, height: 300, name: `${ID.a.slice(0, 4)}.jpg` },
    })
  })

  it('deletePhotoIfUnused removes a photo no collection lists', async () => {
    await store.putPhoto(photo('a'))
    await store.saveCollection(collection('c1', []))
    await store.deletePhotoIfUnused(ID.a)
    expect(await store.getPhoto(ID.a)).toBeUndefined()
  })

  it('deletePhotoIfUnused keeps a photo another collection still lists', async () => {
    await store.putPhoto(photo('a'))
    await store.saveCollection(collection('c1', [ID.a]))
    await store.deletePhotoIfUnused(ID.a)
    expect(await store.getPhoto(ID.a)).toBeDefined()
  })

  it('deleteCollection keeps a photo used by another collection and removes the unused one', async () => {
    await store.putPhoto(photo('a'))
    await store.putPhoto(photo('b'))
    await store.saveCollection(collection('c1', [ID.a, ID.b]))
    await store.saveCollection(collection('c2', [ID.a]))
    await store.deleteCollection('c1')
    expect(await store.getCollection('c1')).toBeUndefined()
    expect(await store.getPhoto(ID.a)).toBeDefined()
    expect(await store.getPhoto(ID.b)).toBeUndefined()
  })

  it('persists sizes and the last collection id', async () => {
    await store.saveSize({ id: 's1', name: '3x4', widthMm: 30, heightMm: 40 })
    expect(await store.listSizes()).toHaveLength(1)
    await store.deleteSize('s1')
    expect(await store.listSizes()).toEqual([])
    expect(await store.getLastCollectionId()).toBeUndefined()
    await store.setLastCollectionId('c9')
    expect(await store.getLastCollectionId()).toBe('c9')
  })

  it('turns QuotaExceededError thrown by put into StorageFullError', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    await expect(store.putPhoto(photo('a'))).rejects.toBeInstanceOf(StorageFullError)
  })

  it('turns a quota failure raised at transaction abort into StorageFullError', async () => {
    const realPut = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const req = realPut.apply(this, args)
      const tx = this.transaction
      Object.defineProperty(tx, 'error', { value: new DOMException('full', 'QuotaExceededError') })
      tx.abort()
      return req
    })
    await expect(store.saveCollection(collection('c1', []))).rejects.toBeInstanceOf(
      StorageFullError,
    )
  })
})

const ANA = { id: 'ana', email: 'ana@example.com' }
const BIA = { id: 'bia', email: 'bia@example.com' }

const ids = async (s: Store = store) => (await s.listCollections()).map((c) => c.id).sort()

describe('sync bookkeeping', () => {
  it('opens a v2 database with data at v3, keeping everything unowned', async () => {
    const name = 't-v2'
    const old = await openDB(name, 2, {
      upgrade(d) {
        d.createObjectStore('photos', { keyPath: 'id' })
        d.createObjectStore('collections', { keyPath: 'id' })
        d.createObjectStore('sizes', { keyPath: 'id' })
        d.createObjectStore('meta')
        d.createObjectStore('folders', { keyPath: 'id' })
      },
    })
    const c = collection('c1', [ID.a])
    const size = { id: 's1', name: '3x4', widthMm: 30, heightMm: 40, folderId: 'f1' }
    const folder = { id: 'f1', name: 'Pasta', createdAt: 1 }
    await old.put('photos', photo('a'))
    await old.put('collections', c)
    await old.put('sizes', size)
    await old.put('folders', folder)
    await old.put('meta', 'c1', 'lastCollectionId')
    old.close()

    const migrated = await createIdbStore(name)
    expect(await migrated.getCollection('c1')).toEqual(c)
    expect(await (await migrated.getPhoto(ID.a))?.original.text()).toBe('orig-a')
    expect(await migrated.listSizes()).toEqual([size])
    expect(await migrated.listFolders()).toEqual([folder])
    expect(await migrated.getLastCollectionId()).toBe('c1')
    expect(await migrated.getSyncStates()).toEqual({})
    expect(await migrated.listTombstones()).toEqual([])
    expect(await migrated.isLibraryDirty()).toBe(false)
    await migrated.setOwner(ANA)
    expect(await ids(migrated)).toEqual(['c1'])
    expect(await migrated.getLastCollectionId()).toBe('c1')
    const raw = await openDB(name)
    expect(raw.version).toBe(3)
    raw.close()
  })

  it('saveCollection marks the collection dirty; without an owner it stays unowned', async () => {
    await store.saveCollection(collection('c1', []))
    expect(await store.getSyncStates()).toEqual({ c1: { dirty: true } })
  })

  it('saveCollection gives an unowned collection the current owner, and keeps an existing one', async () => {
    await store.setOwner(ANA)
    await store.saveCollection(collection('c1', []))
    expect((await store.getSyncStates()).c1).toEqual({
      ownerId: 'ana',
      ownerEmail: 'ana@example.com',
      dirty: true,
    })
    await store.setSyncState('c1', { dirty: false, remoteFileId: 'r1' })
    await store.setOwner(BIA)
    await store.saveCollection(collection('c1', []))
    expect((await store.getSyncStates()).c1).toEqual({
      ownerId: 'ana',
      ownerEmail: 'ana@example.com',
      remoteFileId: 'r1',
      dirty: true,
    })
  })

  it('a failed save leaves no dirty mark behind', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore) {
      throw new DOMException('full', 'QuotaExceededError')
    })
    await expect(store.saveCollection(collection('c1', []))).rejects.toBeInstanceOf(
      StorageFullError,
    )
    vi.restoreAllMocks()
    expect(await store.getSyncStates()).toEqual({})
  })

  it('importCollection and duplicateCollection mark the new collection dirty with the owner', async () => {
    await store.setOwner(ANA)
    await store.importCollection([photo('a')], collection('c1', [ID.a]))
    await store.setSyncState('c1', { dirty: false, remoteFileId: 'r1' })
    await store.duplicateCollection('c1', collection('c2', [ID.a]))
    const states = await store.getSyncStates()
    expect(states.c1).toEqual({
      ownerId: 'ana',
      ownerEmail: ANA.email,
      remoteFileId: 'r1',
      dirty: false,
    })
    expect(states.c2).toEqual({ ownerId: 'ana', ownerEmail: ANA.email, dirty: true })
  })

  it('listCollections shows the current owner and unowned ones; without an owner, all', async () => {
    await store.setOwner(ANA)
    await store.saveCollection(collection('mine', []))
    await store.setOwner(BIA)
    await store.saveCollection(collection('hers', []))
    await store.setOwner(null)
    await store.saveCollection(collection('nobody', []))
    expect(await ids()).toEqual(['hers', 'mine', 'nobody'])
    await store.setOwner(ANA)
    expect(await ids()).toEqual(['mine', 'nobody'])
    expect(await store.getCollection('hers')).toBeDefined()
  })

  it('getLastCollectionId hides a collection of another owner', async () => {
    await store.setOwner(BIA)
    await store.saveCollection(collection('hers', []))
    await store.setLastCollectionId('hers')
    expect(await store.getLastCollectionId()).toBe('hers')
    await store.setOwner(ANA)
    expect(await store.getLastCollectionId()).toBeUndefined()
    await store.setOwner(null)
    expect(await store.getLastCollectionId()).toBe('hers')
  })

  it('setSyncState merges into the existing state', async () => {
    await store.setSyncState('c1', { remoteFileId: 'r1' })
    expect((await store.getSyncStates()).c1).toEqual({ remoteFileId: 'r1', dirty: false })
    await store.setSyncState('c1', { remoteVersion: '7', dirty: true })
    expect((await store.getSyncStates()).c1).toEqual({
      remoteFileId: 'r1',
      remoteVersion: '7',
      dirty: true,
    })
  })

  it('deleteCollection of an uploaded collection leaves a tombstone and drops its state', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000)
    await store.saveCollection(collection('c1', []))
    await store.setSyncState('c1', { remoteFileId: 'r1', dirty: false })
    await store.deleteCollection('c1')
    expect(await store.listTombstones()).toEqual([
      { kind: 'collection', id: 'c1', at: 5000, remoteFileId: 'r1' },
    ])
    expect(await store.getSyncStates()).toEqual({})
  })

  it('deleteCollection of a never uploaded collection leaves no tombstone', async () => {
    await store.saveCollection(collection('c1', []))
    await store.deleteCollection('c1')
    expect(await store.listTombstones()).toEqual([])
    expect(await store.getSyncStates()).toEqual({})
  })

  it('clearTombstones removes only the given ones', async () => {
    await store.saveSize({ id: 's1', name: 'A', widthMm: 1, heightMm: 1 })
    await store.saveFolder({ id: 'f1', name: 'P', createdAt: 1 })
    await store.deleteSize('s1')
    await store.deleteFolder('f1')
    await store.clearTombstones([{ kind: 'size', id: 's1' }])
    expect((await store.listTombstones()).map((t) => `${t.kind}:${t.id}`)).toEqual(['folder:f1'])
  })

  it('putRemoteCollection writes the collection and the given state without marking it dirty', async () => {
    await store.setOwner(ANA)
    const state = {
      ownerId: 'ana',
      ownerEmail: ANA.email,
      remoteFileId: 'r1',
      remoteVersion: '3',
      dirty: false,
    }
    await store.putRemoteCollection(collection('c1', []), state)
    expect(await store.getCollection('c1')).toEqual(collection('c1', []))
    expect((await store.getSyncStates()).c1).toEqual(state)
  })

  it('removeLocalCollection with onlyIfClean keeps a dirty collection', async () => {
    await store.saveCollection(collection('c1', []))
    expect(await store.removeLocalCollection('c1', { onlyIfClean: true })).toBe(false)
    expect(await store.getCollection('c1')).toBeDefined()
    await store.setSyncState('c1', { dirty: false })
    expect(await store.removeLocalCollection('c1', { onlyIfClean: true })).toBe(true)
    expect(await store.getCollection('c1')).toBeUndefined()
  })

  it('putRemoteCollection skips a collection that is dirty here', async () => {
    await store.saveCollection({ ...collection('c1', []), name: 'Local' })
    const wrote = await store.putRemoteCollection(collection('c1', []), {
      remoteFileId: 'r1',
      remoteVersion: '2',
      dirty: false,
    })
    expect(wrote).toBe(false)
    expect((await store.getCollection('c1'))?.name).toBe('Local')
    expect((await store.getSyncStates()).c1).toEqual({ dirty: true })
  })

  it('saveConflictCopy writes the copy dirty and records the seen remote version on the original', async () => {
    await store.setOwner(ANA)
    await store.saveCollection(collection('c1', []))
    await store.setSyncState('c1', { remoteFileId: 'r1', remoteVersion: '1' })
    await store.saveConflictCopy(collection('c2', []), 'c1', 'r1', '2')
    expect(await store.getCollection('c2')).toEqual(collection('c2', []))
    expect(await store.getSyncStates()).toEqual({
      c1: {
        ownerId: 'ana',
        ownerEmail: ANA.email,
        remoteFileId: 'r1',
        remoteVersion: '2',
        dirty: true,
      },
      c2: { ownerId: 'ana', ownerEmail: ANA.email, dirty: true },
    })
  })

  it('getOwner returns the current owner, or null', async () => {
    expect(await store.getOwner()).toBeNull()
    await store.setOwner(ANA)
    expect(await store.getOwner()).toEqual(ANA)
    await store.setOwner(null)
    expect(await store.getOwner()).toBeNull()
  })

  it('markPushed records the file and clears dirty when the collection is unchanged', async () => {
    await store.setOwner(ANA)
    await store.saveCollection(collection('c1', []))
    await store.markPushed('c1', 1000, 'r1', '4')
    expect((await store.getSyncStates()).c1).toEqual({
      ownerId: 'ana',
      ownerEmail: ANA.email,
      remoteFileId: 'r1',
      remoteVersion: '4',
      dirty: false,
    })
  })

  it('markPushed keeps dirty when the collection changed during the upload', async () => {
    await store.saveCollection(collection('c1', []))
    await store.saveCollection({ ...collection('c1', []), updatedAt: 2000 })
    await store.markPushed('c1', 1000, 'r1', '4')
    expect((await store.getSyncStates()).c1).toEqual({
      remoteFileId: 'r1',
      remoteVersion: '4',
      dirty: true,
    })
  })

  it('markPushed does nothing for a collection deleted during the upload', async () => {
    await store.saveCollection(collection('c1', []))
    await store.removeLocalCollection('c1')
    await store.markPushed('c1', 1000, 'r1', '4')
    expect(await store.getSyncStates()).toEqual({})
  })

  it('removeLocalCollection deletes without a tombstone and frees unused photos', async () => {
    await store.putPhoto(photo('a'))
    await store.putPhoto(photo('b'))
    await store.saveCollection(collection('c1', [ID.a, ID.b]))
    await store.saveCollection(collection('c2', [ID.a]))
    await store.setSyncState('c1', { remoteFileId: 'r1' })
    await store.removeLocalCollection('c1')
    expect(await store.getCollection('c1')).toBeUndefined()
    expect(await store.getPhoto(ID.a)).toBeDefined()
    expect(await store.getPhoto(ID.b)).toBeUndefined()
    expect(await store.listTombstones()).toEqual([])
    expect((await store.getSyncStates()).c1).toBeUndefined()
  })

  it('saveSize and saveFolder stamp updatedAt and mark the library dirty', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(7000)
    expect(await store.isLibraryDirty()).toBe(false)
    await store.saveSize({ id: 's1', name: 'A', widthMm: 1, heightMm: 1, updatedAt: 1 })
    expect(await store.listSizes()).toEqual([
      { id: 's1', name: 'A', widthMm: 1, heightMm: 1, updatedAt: 7000 },
    ])
    expect(await store.isLibraryDirty()).toBe(true)
    await store.setLibraryDirty(false)
    expect(await store.isLibraryDirty()).toBe(false)
    await store.saveFolder({ id: 'f1', name: 'P', createdAt: 1 })
    expect(await store.listFolders()).toEqual([
      { id: 'f1', name: 'P', createdAt: 1, updatedAt: 7000 },
    ])
    expect(await store.isLibraryDirty()).toBe(true)
  })

  it('deleteSize marks the library dirty and leaves a tombstone', async () => {
    await store.saveSize({ id: 's1', name: 'A', widthMm: 1, heightMm: 1 })
    await store.setLibraryDirty(false)
    vi.spyOn(Date, 'now').mockReturnValue(8000)
    await store.deleteSize('s1')
    expect(await store.isLibraryDirty()).toBe(true)
    expect(await store.listTombstones()).toEqual([{ kind: 'size', id: 's1', at: 8000 }])
  })

  it('deleteFolder marks the library dirty, leaves a tombstone and restamps the sizes it moves out', async () => {
    await store.saveFolder({ id: 'f1', name: 'P', createdAt: 1 })
    await store.saveSize({ id: 's1', name: 'A', widthMm: 1, heightMm: 1, folderId: 'f1' })
    await store.setLibraryDirty(false)
    vi.spyOn(Date, 'now').mockReturnValue(9000)
    await store.deleteFolder('f1')
    expect(await store.isLibraryDirty()).toBe(true)
    expect(await store.listTombstones()).toEqual([{ kind: 'folder', id: 'f1', at: 9000 }])
    expect(await store.listSizes()).toEqual([
      { id: 's1', name: 'A', widthMm: 1, heightMm: 1, updatedAt: 9000 },
    ])
  })

  it('putRemoteLibrary replaces sizes and folders without marking the library dirty', async () => {
    await store.saveSize({ id: 'old', name: 'Old', widthMm: 1, heightMm: 1 })
    await store.saveFolder({ id: 'oldf', name: 'Old', createdAt: 1 })
    await store.setLibraryDirty(false)
    const sizes = [{ id: 's1', name: 'A', widthMm: 1, heightMm: 1, updatedAt: 3 }]
    const folders = [{ id: 'f1', name: 'P', createdAt: 1, updatedAt: 4 }]
    await store.putRemoteLibrary(sizes, folders)
    expect(await store.listSizes()).toEqual(sizes)
    expect(await store.listFolders()).toEqual(folders)
    expect(await store.isLibraryDirty()).toBe(false)
  })

  it('listOtherOwners counts the collections of each other owner', async () => {
    await store.setOwner(BIA)
    await store.saveCollection(collection('b1', []))
    await store.saveCollection(collection('b2', []))
    await store.setOwner(ANA)
    await store.saveCollection(collection('a1', []))
    await store.setOwner(null)
    await store.saveCollection(collection('n1', []))
    await store.setOwner(ANA)
    expect(await store.listOtherOwners()).toEqual([{ id: 'bia', email: BIA.email, count: 2 }])
  })

  it('claimCollections moves them to the current owner as new, dirty uploads', async () => {
    await store.setOwner(BIA)
    await store.saveCollection(collection('b1', []))
    await store.setSyncState('b1', { remoteFileId: 'r1', remoteVersion: '2', dirty: false })
    await store.setOwner(ANA)
    expect(await ids()).toEqual([])
    await store.claimCollections('bia')
    expect(await ids()).toEqual(['b1'])
    expect((await store.getSyncStates()).b1).toEqual({
      ownerId: 'ana',
      ownerEmail: ANA.email,
      dirty: true,
    })
    expect(await store.listOtherOwners()).toEqual([])
  })
})

describe('photo reader', () => {
  it('reads photos from the database without asking for a version', async () => {
    await store.putPhoto(photo('a'))
    const name = `test-${dbCount - 1}`
    const reader = await openPhotoReader(name)
    expect(await (await reader.getPhoto(ID.a))?.original.text()).toBe('orig-a')
    expect(await reader.getPhotosMeta([ID.a])).toEqual({
      [ID.a]: { id: ID.a, width: 400, height: 300, name: photo('a').name },
    })
  })

  it('opens a database newer than this app without VersionError', async () => {
    const name = 't-reader-newer'
    const newer = await openDB(name, 9, {
      upgrade(d) {
        d.createObjectStore('photos', { keyPath: 'id' })
      },
    })
    await newer.put('photos', photo('a'))
    newer.close()
    const reader = await openPhotoReader(name)
    expect(await reader.getPhoto(ID.a)).toBeDefined()
  })

  it('steps aside for an upgrade and reads again afterwards', async () => {
    const name = 't-reader-upgrade'
    const s = await createIdbStore(name)
    await s.putPhoto(photo('a'))
    const reader = await openPhotoReader(name)
    await reader.getPhoto(ID.a)
    const upgraded = await openDB(name, 4)
    upgraded.close()
    expect(await reader.getPhoto(ID.a)).toBeDefined()
  })

  it('never creates an empty database', async () => {
    const name = 't-reader-missing'
    await expect(openPhotoReader(name)).rejects.toThrow()
    const s = await createIdbStore(name)
    expect(await s.listSizes()).toEqual([])
  })
})

describe('bundle', () => {
  it('round-trips frames and photos under a new collection id', async () => {
    await store.putPhoto(photo('a'))
    await store.putPhoto(photo('b'))
    const original = collection('c1', [ID.a, ID.b])
    await store.saveCollection(original)

    const file = await exportBundle(store, 'c1')
    const target = await createIdbStore(`test-${dbCount++}`)
    const imported = await importBundle(target, file)

    expect(imported.id).not.toBe('c1')
    expect(imported).toEqual({ ...original, id: imported.id })
    expect(await target.getCollection(imported.id)).toEqual(imported)
    const got = await target.getPhoto(ID.b)
    expect(got).toMatchObject({ width: 400, height: 300, name: `${ID.b.slice(0, 4)}.jpg` })
    expect(await got!.original.text()).toBe('orig-b')
    expect(got!.original.type).toBe('image/png')
    expect(await got!.preview.text()).toBe('prev-b')
    expect(await got!.thumb.text()).toBe('thumb-b')
  })

  it('exporting a missing collection rejects', async () => {
    await expect(exportBundle(store, 'nope')).rejects.toThrow(Error)
  })

  async function unzipExport(): Promise<Record<string, Uint8Array>> {
    await store.putPhoto(photo('a'))
    await store.putPhoto(photo('b'))
    await store.saveCollection(collection('c1', [ID.a, ID.b]))
    return unzipSync(new Uint8Array(await (await exportBundle(store, 'c1')).arrayBuffer()))
  }

  async function expectRejectsWithoutWriting(file: Blob) {
    const target = await createIdbStore(`test-${dbCount++}`)
    await expect(importBundle(target, file)).rejects.toThrow(Error)
    expect(await target.listCollections()).toEqual([])
    expect(await target.getPhoto(ID.a)).toBeUndefined()
  }

  it('rejects a file that is not a bundle without writing anything', async () => {
    await expectRejectsWithoutWriting(new Blob(['not a zip']))
  })

  it('rejects an unsupported schemaVersion without writing anything', async () => {
    const files = await unzipExport()
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    manifest.collection.schemaVersion = 2
    files['manifest.json'] = strToU8(JSON.stringify(manifest))
    await expectRejectsWithoutWriting(new Blob([zipSync(files) as BlobPart]))
  })

  it('rejects a bundle missing a photo file without writing anything', async () => {
    const files = await unzipExport()
    delete files[`photos/${ID.b}/thumb`]
    await expectRejectsWithoutWriting(new Blob([zipSync(files) as BlobPart]))
  })

  it('rejects a bundle whose photo content does not match its id, writing nothing', async () => {
    const files = await unzipExport()
    files[`photos/${ID.b}/original`] = strToU8('tampered')
    await expectRejectsWithoutWriting(new Blob([zipSync(files) as BlobPart]))
  })

  it('ignores unrelated entries in the bundle', async () => {
    const files = await unzipExport()
    files['junk/huge.bin'] = new Uint8Array(1024)
    files['photos/not-hex/original'] = new Uint8Array(8)
    const target = await createIdbStore(`test-${dbCount++}`)
    const imported = await importBundle(target, new Blob([zipSync(files) as BlobPart]))
    expect(imported.photoIds).toEqual([ID.a, ID.b])
    expect(await target.getPhoto(ID.a)).toBeDefined()
  })

  it('rejects a bundle with more than 2000 entries, writing nothing', async () => {
    const files = await unzipExport()
    for (let i = 0; i < 2000; i++) files[`extra/${i}`] = new Uint8Array(0)
    await expectRejectsWithoutWriting(new Blob([zipSync(files) as BlobPart]))
  })

  it('rejects a bundle declaring more than 2 GiB uncompressed, writing nothing', async () => {
    const zipped = zipSync(await unzipExport(), { level: 0 })
    const view = new DataView(zipped.buffer, zipped.byteOffset, zipped.byteLength)
    for (let i = 0; i + 28 < zipped.length; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 0xffffffff, true)
    }
    await expectRejectsWithoutWriting(new Blob([zipped as BlobPart]))
  })

  it('leaves no photos or collection behind when the import hits the storage quota', async () => {
    await store.putPhoto(photo('a'))
    await store.putPhoto(photo('b'))
    await store.saveCollection(collection('c1', [ID.a, ID.b]))
    const file = await exportBundle(store, 'c1')
    const target = await createIdbStore(`test-${dbCount++}`)
    const realPut = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'collections') throw new DOMException('full', 'QuotaExceededError')
      return realPut.apply(this, args)
    })
    await expect(importBundle(target, file)).rejects.toBeInstanceOf(StorageFullError)
    vi.restoreAllMocks()
    expect(await target.getPhoto(ID.a)).toBeUndefined()
    expect(await target.getPhoto(ID.b)).toBeUndefined()
    expect(await target.listCollections()).toEqual([])
  })

  it('never overwrites a photo that already exists', async () => {
    await store.putPhoto(photo('a'))
    await store.saveCollection(collection('c1', [ID.a]))
    const file = await exportBundle(store, 'c1')
    const target = await createIdbStore(`test-${dbCount++}`)
    const existing = { ...photo('a'), name: 'mine.jpg', thumb: new Blob(['kept']) }
    await target.putPhoto(existing)
    await importBundle(target, file)
    const got = await target.getPhoto(ID.a)
    expect(got!.name).toBe('mine.jpg')
    expect(await got!.thumb.text()).toBe('kept')
  })
})
