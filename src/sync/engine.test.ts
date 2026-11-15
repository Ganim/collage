// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Collection } from '../core/types'
import type { Decode } from '../photos/import'
import { createIdbStore } from '../storage/indexeddb'
import type { Store, StoredPhoto } from '../storage/store'
import { DriveAuthError } from '../ui/account/account'
import { DriveError, type Drive } from './drive'
import { createSyncEngine } from './engine'
import { createFakeDrive, type FakeDrive } from './fakeDrive'
import { useSyncStatus } from './status'

const ANA = { id: 'ana', email: 'ana@example.com' }
const NOW = 1_700_000_000_000
const SUFFIX = ' (cópia de outro aparelho)'

function photo(id: string): StoredPhoto {
  return {
    id,
    width: 400,
    height: 300,
    name: `${id}.png`,
    original: new Blob([`orig-${id}`], { type: 'image/png' }),
    preview: new Blob([`prev-${id}`], { type: 'image/jpeg' }),
    thumb: new Blob([`thumb-${id}`], { type: 'image/jpeg' }),
  }
}

function collection(id: string, photoIds: string[], extra: Partial<Collection> = {}): Collection {
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
    ...extra,
  }
}

const decoded: string[] = []
const decode: Decode = async (file) => {
  decoded.push(file.name)
  return {
    width: 400,
    height: 300,
    preview: new Blob([`prev-of-${await file.text()}`], { type: 'image/jpeg' }),
    thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
  }
}

let dbCount = 0
async function device(): Promise<Store> {
  const store = await createIdbStore(`engine-${dbCount++}`)
  await store.setOwner(ANA)
  return store
}

const engineFor = (store: Store, drive: Drive) =>
  createSyncEngine({ store, drive, decode, now: () => NOW })

const filesOf = (drive: FakeDrive, kind: string) =>
  [...drive.files.values()].filter((f) => !f.trashed && f.appProperties.kind === kind)

const status = () => useSyncStatus.getState()

let drive: FakeDrive
let a: Store
let b: Store
beforeEach(async () => {
  useSyncStatus.setState({
    state: 'off',
    error: undefined,
    lastSyncedAt: undefined,
    photos: undefined,
    changeCount: 0,
    changedIds: [],
  })
  decoded.length = 0
  drive = createFakeDrive()
  a = await device()
  b = await device()
})

afterEach(() => {
  vi.useRealTimers()
})

/** A drive whose method `name` fails once with `error` when `when` matches its arguments. */
function failingOnce<K extends keyof Drive>(
  base: Drive,
  name: K,
  error: Error,
  when: (...args: Parameters<Drive[K]>) => boolean = () => true,
): Drive {
  let failed = false
  return {
    ...base,
    [name]: (...args: Parameters<Drive[K]>) => {
      if (!failed && when(...args)) {
        failed = true
        return Promise.reject(error)
      }
      return (base[name] as (...a: Parameters<Drive[K]>) => unknown)(...args)
    },
  }
}

describe('sync engine between two devices', () => {
  it('A creates; B receives the collection, its photos, sizes and folders', async () => {
    await a.importCollection([photo('p1'), photo('p2')], collection('c1', ['p1', 'p2']))
    await a.saveFolder({ id: 'f1', name: 'Pasta', createdAt: 1 })
    await a.saveSize({ id: 's1', name: '3x4', widthMm: 30, heightMm: 40, folderId: 'f1' })
    await engineFor(a, drive).run()
    expect(status().state).toBe('idle')
    expect(await a.getSyncStates()).toMatchObject({ c1: { dirty: false } })
    expect(await a.isLibraryDirty()).toBe(false)

    await engineFor(b, drive).run()
    expect(await b.getCollection('c1')).toEqual(collection('c1', ['p1', 'p2']))
    expect((await b.getSyncStates()).c1).toMatchObject({ ownerId: 'ana', dirty: false })
    const p1 = await b.getPhoto('p1')
    expect(p1).toMatchObject({ id: 'p1', name: 'p1.png', width: 400, height: 300 })
    expect(await p1?.original.text()).toBe('orig-p1')
    expect(p1?.original.type).toBe('image/png')
    expect(await p1?.preview.text()).toBe('prev-of-orig-p1')
    expect(await b.getPhoto('p2')).toBeDefined()
    expect(await b.listFolders()).toEqual(await a.listFolders())
    expect(await b.listSizes()).toEqual(await a.listSizes())
    expect(status()).toMatchObject({ state: 'idle', lastSyncedAt: NOW, photos: undefined })
    expect(status().changedIds).toContain('c1')
    expect(status().changeCount).toBeGreaterThan(0)
    expect(filesOf(drive, 'photo')).toHaveLength(2)
    expect(filesOf(drive, 'collection')).toHaveLength(1)
    expect(filesOf(drive, 'library')).toHaveLength(1)
  })

  it('B edits; A receives the edit', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    await b.saveCollection(collection('c1', ['p1'], { name: 'Editada', updatedAt: 2000 }))
    await engineFor(b, drive).run()

    await engineFor(a, drive).run()
    expect((await a.getCollection('c1'))?.name).toBe('Editada')
    expect((await a.getSyncStates()).c1?.dirty).toBe(false)
    expect(filesOf(drive, 'collection')).toHaveLength(1)
  })

  it('both edit; A keeps both versions, the other one with the suffix', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    await b.putPhoto(photo('p2'))
    await b.saveCollection(collection('c1', ['p1', 'p2'], { name: 'De B', updatedAt: 2000 }))
    await engineFor(b, drive).run()
    await a.saveCollection(collection('c1', ['p1'], { name: 'De A', updatedAt: 3000 }))

    await engineFor(a, drive).run()
    const names = (await a.listCollections()).map((c) => c.name).sort()
    expect(names).toEqual(['De A', `De B${SUFFIX}`])
    const copy = (await a.listCollections()).find((c) => c.name.endsWith(SUFFIX))!
    expect(status().changedIds).toContain(copy.id)
    // The copy's photo came down too.
    expect(await a.getPhoto('p2')).toBeDefined()
    expect(Object.values(await a.getSyncStates()).every((s) => !s.dirty)).toBe(true)

    // And B ends with both as well.
    await engineFor(b, drive).run()
    expect((await b.listCollections()).map((c) => c.name).sort()).toEqual(names)
  })

  it('a conflict with identical content adopts the remote file without a copy', async () => {
    await a.saveCollection(collection('c1', []))
    // The upload landed but the device never recorded it.
    await drive.create(
      await drive.ensureFolder(),
      'collection-c1.json',
      new Blob([JSON.stringify(collection('c1', []))], { type: 'application/json' }),
      { kind: 'collection', collectionId: 'c1' },
    )
    await engineFor(a, drive).run()
    expect(await a.listCollections()).toHaveLength(1)
    expect((await a.getSyncStates()).c1?.dirty).toBe(false)
    expect(filesOf(drive, 'collection')).toHaveLength(1)
  })

  it('A deletes; it is gone in B', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    await a.deleteCollection('c1')
    await engineFor(a, drive).run()
    expect(await a.listTombstones()).toEqual([])
    expect(filesOf(drive, 'collection')).toHaveLength(0)

    await engineFor(b, drive).run()
    expect(await b.getCollection('c1')).toBeUndefined()
    expect(await b.getPhoto('p1')).toBeUndefined()
    expect(status().changedIds).toContain('c1')
    expect(status().state).toBe('idle')
  })

  it('A deletes while B has a local change; the collection comes back', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    await a.deleteCollection('c1')
    await engineFor(a, drive).run()
    await b.saveCollection(collection('c1', ['p1'], { name: 'Mantida', updatedAt: 2000 }))

    await engineFor(b, drive).run()
    expect((await b.getCollection('c1'))?.name).toBe('Mantida')
    expect((await b.getSyncStates()).c1?.dirty).toBe(false)

    await engineFor(a, drive).run()
    expect((await a.getCollection('c1'))?.name).toBe('Mantida')
    expect(await a.getPhoto('p1')).toBeDefined()
  })

  it('a deleted size reaches the other device', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(5000)
    await a.saveSize({ id: 's1', name: '3x4', widthMm: 30, heightMm: 40 })
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    expect(await b.listSizes()).toHaveLength(1)
    vi.setSystemTime(6000)
    await a.deleteSize('s1')
    await engineFor(a, drive).run()
    expect(await a.listTombstones()).toEqual([])
    await engineFor(b, drive).run()
    expect(await b.listSizes()).toEqual([])
  })

  it('network fails after the photos and before the collection; the next pass completes without duplicate photos', async () => {
    await a.importCollection([photo('p1'), photo('p2')], collection('c1', ['p1', 'p2']))
    const flaky = failingOnce(drive, 'create', new DriveError('offline', 'down'), (_f, name) =>
      name.startsWith('collection-'),
    )
    const engine = engineFor(a, flaky)
    await engine.run()
    expect(status().state).toBe('offline')
    expect(filesOf(drive, 'photo')).toHaveLength(2)
    expect(filesOf(drive, 'collection')).toHaveLength(0)
    expect((await a.getSyncStates()).c1?.dirty).toBe(true)

    await engine.run()
    expect(status().state).toBe('idle')
    expect(filesOf(drive, 'photo')).toHaveLength(2)
    expect(filesOf(drive, 'collection')).toHaveLength(1)
    expect((await a.getSyncStates()).c1?.dirty).toBe(false)
  })

  it('an edit saved during the upload stays dirty and goes up on the next pass', async () => {
    await a.saveCollection(collection('c1', []))
    const editing: Drive = {
      ...drive,
      async create(folder, name, body, props) {
        const file = await drive.create(folder, name, body, props)
        if (name.startsWith('collection-'))
          await a.saveCollection(collection('c1', [], { name: 'Durante', updatedAt: 2000 }))
        return file
      },
    }
    await engineFor(a, editing).run()
    expect((await a.getSyncStates()).c1).toMatchObject({ dirty: true, remoteVersion: '1' })

    await engineFor(a, drive).run()
    expect((await a.getSyncStates()).c1?.dirty).toBe(false)
    const files = filesOf(drive, 'collection')
    expect(files).toHaveLength(1)
    expect(JSON.parse(await files[0]!.body.text())).toMatchObject({ name: 'Durante' })
  })

  it('an edit saved during the pass is never deleted by a deletion from elsewhere', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    await a.deleteCollection('c1')
    await engineFor(a, drive).run()
    // B plans deleteLocal; the person edits right before it runs.
    const editingB: Store = {
      ...b,
      async removeLocalCollection(id, options) {
        await b.saveCollection(collection('c1', ['p1'], { name: 'No meio', updatedAt: 2000 }))
        return b.removeLocalCollection(id, options)
      },
    }
    await engineFor(editingB, drive).run()
    expect((await b.getCollection('c1'))?.name).toBe('No meio')

    await engineFor(b, drive).run()
    await engineFor(a, drive).run()
    expect((await a.getCollection('c1'))?.name).toBe('No meio')
  })

  it('an edit saved before a pull is never overwritten', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    await a.saveCollection(collection('c1', ['p1'], { name: 'De A', updatedAt: 2000 }))
    await engineFor(a, drive).run()
    const editingB: Store = {
      ...b,
      async putRemoteCollection(c, state) {
        await b.saveCollection(collection('c1', ['p1'], { name: 'De B', updatedAt: 3000 }))
        return b.putRemoteCollection(c, state)
      },
    }
    await engineFor(editingB, drive).run()
    expect((await b.getCollection('c1'))?.name).toBe('De B')
    expect((await b.getSyncStates()).c1?.dirty).toBe(true)
  })

  it('a conflict cut short after the copy makes no second copy on the next pass', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    await b.saveCollection(collection('c1', ['p1'], { name: 'De B', updatedAt: 2000 }))
    await engineFor(b, drive).run()
    await a.saveCollection(collection('c1', ['p1'], { name: 'De A', updatedAt: 3000 }))

    await engineFor(a, failingOnce(drive, 'update', new DriveError('offline', 'down'))).run()
    expect(status().state).toBe('offline')
    expect(await a.listCollections()).toHaveLength(2)

    await engineFor(a, drive).run()
    expect(status().state).toBe('idle')
    const names = (await a.listCollections()).map((c) => c.name).sort()
    expect(names).toEqual(['De A', `De B${SUFFIX}`])
    expect(filesOf(drive, 'collection')).toHaveLength(2)
  })

  it('a photo file that vanished before its download is skipped; a server error is not', async () => {
    await a.importCollection([photo('p1'), photo('p2')], collection('c1', ['p1', 'p2']))
    await engineFor(a, drive).run()
    const p2 = filesOf(drive, 'photo').find((f) => f.appProperties.photoId === 'p2')!
    const gone = failingOnce(
      drive,
      'download',
      new DriveError('other', 'Google Drive request failed (404)', 404),
      (id) => id === p2.id,
    )
    await engineFor(b, gone).run()
    expect(status().state).toBe('idle')
    expect(await b.getPhoto('p1')).toBeDefined()
    expect(await b.getPhoto('p2')).toBeUndefined()

    const busy = failingOnce(
      drive,
      'download',
      new DriveError('other', 'Google Drive request failed (503)', 503),
    )
    await engineFor(b, busy).run()
    expect(status()).toMatchObject({ state: 'error', error: 'other' })

    const down = failingOnce(drive, 'download', new DriveError('offline', 'down'))
    await engineFor(b, down).run()
    expect(status().state).toBe('offline')
  })

  it('a photo whose file the fake Drive no longer has is skipped as a 404', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    const p1 = filesOf(drive, 'photo')[0]!
    const vanishing: Drive = {
      ...drive,
      async list(folder) {
        const files = await drive.list(folder)
        drive.files.delete(p1.id)
        return files
      },
    }
    await engineFor(b, vanishing).run()
    expect(status().state).toBe('idle')
    expect(await b.getPhoto('p1')).toBeUndefined()
  })

  it('skips a photo whose Drive file is missing', async () => {
    await a.importCollection([photo('p1'), photo('p2')], collection('c1', ['p1', 'p2']))
    await engineFor(a, drive).run()
    filesOf(drive, 'photo').find((f) => f.appProperties.photoId === 'p2')!.trashed = true
    await engineFor(b, drive).run()
    expect(status().state).toBe('idle')
    expect(await b.getPhoto('p1')).toBeDefined()
    expect(await b.getPhoto('p2')).toBeUndefined()
  })

  it('downloadMissingPhotos starts with the priority ids', async () => {
    await a.importCollection(
      [photo('p1'), photo('p2'), photo('p3')],
      collection('c1', ['p1', 'p2', 'p3']),
    )
    await engineFor(a, drive).run()
    const folder = await drive.ensureFolder()
    const files = await drive.list(folder)
    // B has the collection but none of its photos yet.
    const engine = engineFor(b, drive)
    await b.putRemoteCollection(collection('c1', ['p1', 'p2', 'p3']), {
      ownerId: 'ana',
      ownerEmail: ANA.email,
      remoteFileId: files.find((f) => f.appProperties.kind === 'collection')!.id,
      remoteVersion: '1',
      dirty: false,
    })
    await engine.downloadMissingPhotos(['p3'])
    expect(decoded).toEqual(['p3.png', 'p1.png', 'p2.png'])
    expect(status().photos).toBeUndefined()
    expect(status().changedIds).toEqual(['c1'])
  })

  it('concurrent runs join the same pass', async () => {
    await a.saveCollection(collection('c1', []))
    const engine = engineFor(a, drive)
    const first = engine.run()
    expect(engine.run()).toBe(first)
    await first
    expect(filesOf(drive, 'collection')).toHaveLength(1)
  })
})

describe('sync status', () => {
  it('shows syncing during a pass', async () => {
    let seen: string | undefined
    const watching: Drive = {
      ...drive,
      async list(folder) {
        seen = status().state
        return drive.list(folder)
      },
    }
    await engineFor(a, watching).run()
    expect(seen).toBe('syncing')
    expect(status().state).toBe('idle')
  })

  it.each([
    [new DriveAuthError('no_drive'), { state: 'needsDrive' }],
    [new DriveAuthError('revoked'), { state: 'error', error: 'revoked' }],
    [new DriveAuthError('signed_out'), { state: 'off' }],
    [new DriveError('offline', 'x'), { state: 'offline' }],
    [new DriveError('revoked', 'x'), { state: 'error', error: 'revoked' }],
    [new DriveError('other', 'x'), { state: 'error', error: 'other' }],
    [new Error('service unreachable'), { state: 'offline' }],
  ])('%s while opening the folder → %o', async (error, expected) => {
    await engineFor(a, failingOnce(drive, 'ensureFolder', error)).run()
    expect(status()).toMatchObject(expected)
    expect(status().lastSyncedAt).toBeUndefined()
  })

  it('a full Drive is an error with the reason full, and the next pass clears it', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    const engine = engineFor(a, failingOnce(drive, 'create', new DriveError('full', 'full')))
    await engine.run()
    expect(status()).toMatchObject({ state: 'error', error: 'full' })
    await engine.run()
    expect(status()).toMatchObject({ state: 'idle', error: undefined, lastSyncedAt: NOW })
  })

  it('is off without a signed-in owner', async () => {
    await a.setOwner(null)
    await engineFor(a, drive).run()
    expect(status().state).toBe('off')
    expect(drive.files.size).toBe(0)
  })
})
