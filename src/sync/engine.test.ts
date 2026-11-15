// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { Collection } from '../core/types'
import type { Decode } from '../photos/import'
import { createIdbStore } from '../storage/indexeddb'
import type { Store, StoredPhoto } from '../storage/store'
import { DriveAuthError, DriveNetworkError } from '../ui/account/account'
import { DriveError, type Drive } from './drive'
import { createSyncEngine } from './engine'
import { createFakeDrive, type FakeDrive } from './fakeDrive'
import { md5 } from './md5'
import { fitAppProperties } from './remote'
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
/** The engine logs unexpected failures; the tests keep that quiet and look at it when it matters. */
let errorLog: MockInstance<typeof console.error>
beforeEach(async () => {
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
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
  errorLog.mockRestore()
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
    // The adopted file's checksum is kept, so a later metadata-only version is no conflict.
    const [listed] = await drive.list(await drive.ensureFolder())
    expect((await a.getSyncStates()).c1?.remoteMd5).toBe(listed?.md5Checksum)
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

  it('the fake Drive lists the MD5 of each body, as Google does', async () => {
    await a.saveCollection(collection('c1', []))
    await engineFor(a, drive).run()
    const [file] = await drive.list(await drive.ensureFolder())
    expect(file?.md5Checksum).toBe(md5(await drive.files.get(file!.id)!.body.text()))
    // What the device recorded is the MD5 of the very bytes it sent.
    expect((await a.getSyncStates()).c1?.remoteMd5).toBe(file?.md5Checksum)
  })

  it('a new Drive version with the content this device sent is no conflict', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    // Something touched the file on the Drive (its version grows) without changing its content.
    const [file] = filesOf(drive, 'collection')
    file!.version = String(Number(file!.version) + 1)
    await a.saveCollection(collection('c1', ['p1'], { name: 'Editada', updatedAt: 2000 }))

    await engineFor(a, drive).run()
    expect(status().state).toBe('idle')
    expect((await a.listCollections()).map((c) => c.name)).toEqual(['Editada'])
    expect(filesOf(drive, 'collection')).toHaveLength(1)
    expect(JSON.parse(await filesOf(drive, 'collection')[0]!.body.text())).toMatchObject({
      name: 'Editada',
    })
    expect((await a.getSyncStates()).c1?.dirty).toBe(false)
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
    expect(errorLog).not.toHaveBeenCalled()
    await engineFor(b, busy).run()
    expect(status()).toMatchObject({ state: 'error', error: 'other' })
    expect(errorLog.mock.calls).toEqual([['Sync failed:', 'DriveError']])

    const down = failingOnce(drive, 'download', new DriveError('offline', 'down'))
    await engineFor(b, down).run()
    expect(status().state).toBe('offline')
  })

  it('a photo the Drive refuses for good (403 forbidden) is skipped; a rate limit is not', async () => {
    await a.importCollection([photo('p1'), photo('p2')], collection('c1', ['p1', 'p2']))
    await engineFor(a, drive).run()
    const p2 = filesOf(drive, 'photo').find((f) => f.appProperties.photoId === 'p2')!
    const refused: Drive = {
      ...drive,
      download: (id) =>
        id === p2.id
          ? Promise.reject(new DriveError('other', 'failed (403)', 403, 'forbidden'))
          : drive.download(id),
    }
    await engineFor(b, refused).run()
    expect(status().state).toBe('idle')
    expect(await b.getPhoto('p1')).toBeDefined()
    expect(await b.getPhoto('p2')).toBeUndefined()
    // The next pass is not stuck on it either.
    await engineFor(b, refused).run()
    expect(status().state).toBe('idle')

    for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded']) {
      const limited = failingOnce(
        drive,
        'download',
        new DriveError('other', 'failed (403)', 403, reason),
      )
      await engineFor(b, limited).run()
      expect(status()).toMatchObject({ state: 'error', error: 'other' })
    }
    const revoked = failingOnce(
      drive,
      'download',
      new DriveError('revoked', 'not granted', 403, 'insufficientPermissions'),
    )
    await engineFor(b, revoked).run()
    expect(status()).toMatchObject({ state: 'error', error: 'revoked' })
    const limited429 = failingOnce(drive, 'download', new DriveError('other', 'failed', 429))
    await engineFor(b, limited429).run()
    expect(status()).toMatchObject({ state: 'error', error: 'other' })
  })

  it('a photo with a very long accented name still goes up and comes down', async () => {
    const name = ('Fotografia de família à beira-mar em São João — ' + 'çãé'.repeat(60)).slice(
      0,
      200,
    )
    expect(name.length).toBe(200)
    await a.importCollection([{ ...photo('p1'), name }], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    expect(status().state).toBe('idle')
    const file = filesOf(drive, 'photo')[0]!
    for (const [key, value] of Object.entries(file.appProperties)) {
      expect(new TextEncoder().encode(key + value).length).toBeLessThanOrEqual(124)
    }
    expect(name.startsWith(file.appProperties.name!)).toBe(true)
    expect(file.appProperties.name!.length).toBeGreaterThan(50)
    await engineFor(b, drive).run()
    expect(status().state).toBe('idle')
    expect(await b.getPhoto('p1')).toMatchObject({ name: file.appProperties.name })
  })

  it('the fake Drive refuses an appProperty over 124 bytes, as Google does', async () => {
    const folder = await drive.ensureFolder()
    await expect(
      drive.create(folder, 'x', new Blob(['x']), { name: 'é'.repeat(61) }),
    ).rejects.toMatchObject({ kind: 'other', status: 400 })
    await expect(
      drive.create(folder, 'x', new Blob(['x']), { name: 'é'.repeat(60) }),
    ).resolves.toBeDefined()
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

  it('run passes its priority on to the photo downloads', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1'], { updatedAt: 2000 }))
    await a.importCollection([photo('p2')], collection('c2', ['p2'], { updatedAt: 1000 }))
    await engineFor(a, drive).run()
    decoded.length = 0
    await engineFor(b, drive).run(['c2'])
    expect(decoded).toEqual(['p2.png', 'p1.png'])
  })

  it('cancel stops the running pass at its next wait, without touching the status', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow: Drive = {
      ...drive,
      async list(folder) {
        await gate
        return drive.list(folder)
      },
    }
    const engine = engineFor(a, slow)
    const pass = engine.run()
    await vi.waitFor(() => expect(status().state).toBe('syncing'))
    engine.cancel()
    useSyncStatus.setState({ state: 'off' })
    release()
    await pass
    expect(status().state).toBe('off')
    expect(status().lastSyncedAt).toBeUndefined()
    expect(drive.files.size).toBe(0)
    expect((await a.getSyncStates()).c1?.dirty).toBe(true)

    // The same engine syncs normally afterwards.
    await engine.run()
    expect(status()).toMatchObject({ state: 'idle', lastSyncedAt: NOW })
    expect(filesOf(drive, 'collection')).toHaveLength(1)
  })

  it('a run right after cancel starts a new pass instead of joining the cancelled one', async () => {
    await a.saveCollection(collection('c1', []))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let lists = 0
    const slow: Drive = {
      ...drive,
      async list(folder) {
        if (lists++ === 0) await gate
        return drive.list(folder)
      },
    }
    const engine = engineFor(a, slow)
    const cancelled = engine.run()
    await vi.waitFor(() => expect(lists).toBe(1))
    engine.cancel()
    const next = engine.run()
    expect(next).not.toBe(cancelled)
    await next
    expect(status().state).toBe('idle')
    release()
    await cancelled
    expect(status().state).toBe('idle')
    expect(filesOf(drive, 'collection')).toHaveLength(1)
  })

  it('cancel also stops a photo download in progress, leaving the status alone', async () => {
    await a.importCollection([photo('p1'), photo('p2')], collection('c1', ['p1', 'p2']))
    await engineFor(a, drive).run()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow: Drive = {
      ...drive,
      async download(id) {
        const body = await drive.download(id)
        if (drive.files.get(id)?.appProperties.kind === 'photo') await gate
        return body
      },
    }
    const engine = engineFor(b, slow)
    const pass = engine.run()
    await vi.waitFor(() => expect(status().photos).toEqual({ done: 0, total: 2 }))
    engine.cancel()
    release()
    await pass
    expect(status().photos).toEqual({ done: 0, total: 2 })
    expect(await b.getPhoto('p1')).toBeUndefined()
    expect(await b.getPhoto('p2')).toBeUndefined()
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
    [new DriveNetworkError(), { state: 'offline' }],
    // Real fetch rejections arrive as DriveError('offline') or DriveNetworkError; a bare
    // TypeError is a bug.
    [new TypeError('x is not a function'), { state: 'error', error: 'other' }],
    [new DOMException('The operation was aborted.', 'AbortError'), { state: 'offline' }],
    [new Error('Drive token request failed (502)'), { state: 'error', error: 'other' }],
    [new RangeError('a bug'), { state: 'error', error: 'other' }],
  ])('%s while opening the folder → %o', async (error, expected) => {
    await engineFor(a, failingOnce(drive, 'ensureFolder', error)).run()
    expect(status()).toMatchObject(expected)
    expect(status().lastSyncedAt).toBeUndefined()
    // Only a failure that reads as "Não foi possível sincronizar" is logged.
    const unexpected = 'error' in expected && expected.error === 'other'
    expect(errorLog.mock.calls).toEqual(unexpected ? [['Sync failed:', error.name]] : [])
  })

  it('logs an unexpected failure with a fixed text and the error name only', async () => {
    const log = errorLog
    const secret = new SyntaxError('token=abc123 at /api/auth')
    await engineFor(a, failingOnce(drive, 'ensureFolder', secret)).run()
    expect(status()).toMatchObject({ state: 'error', error: 'other' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]).toEqual(['Sync failed:', 'SyntaxError'])

    log.mockClear()
    await engineFor(a, failingOnce(drive, 'ensureFolder', new TypeError('x'))).run()
    expect(log.mock.calls).toEqual([['Sync failed:', 'TypeError']])

    log.mockClear()
    await engineFor(a, failingOnce(drive, 'ensureFolder', new DriveError('offline', 'x'))).run()
    await engineFor(a, failingOnce(drive, 'ensureFolder', new DriveNetworkError())).run()
    expect(log).not.toHaveBeenCalled()
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

describe('fitAppProperties', () => {
  const bytes = (text: string) => new TextEncoder().encode(text).length

  it('keeps short values as they are', () => {
    expect(fitAppProperties({ kind: 'photo', width: '400' })).toEqual({
      kind: 'photo',
      width: '400',
    })
  })

  it('cuts on a code-point boundary, never inside an emoji', () => {
    const value = 'a'.repeat(118) + '😀😀'
    const { name } = fitAppProperties({ name: value })
    expect(bytes('name' + name!)).toBeLessThanOrEqual(124)
    expect(name).toBe('a'.repeat(118))
    const fits = fitAppProperties({ name: 'a'.repeat(116) + '😀😀' }).name!
    expect(fits).toBe('a'.repeat(116) + '😀')
    expect(bytes('name' + fits)).toBe(124)
  })
})

describe('remove from and send to the Drive', () => {
  const libraryOnDrive = async () =>
    JSON.parse(await filesOf(drive, 'library')[0]!.body.text()) as {
      detached: { collection: Record<string, number> }
    }
  const collectionFile = (id: string) =>
    filesOf(drive, 'collection').find((f) => f.appProperties.collectionId === id)!
  const photoIdsOnDrive = () =>
    filesOf(drive, 'photo')
      .map((f) => f.appProperties.photoId)
      .sort()
  const collectionIdsOnDrive = () =>
    filesOf(drive, 'collection')
      .map((f) => f.appProperties.collectionId)
      .sort()

  /** A and B both hold c1 (photos p1, p2) and c2 (photos p2, p3), all synced. */
  async function bothSynced(): Promise<void> {
    await a.importCollection([photo('p1'), photo('p2')], collection('c1', ['p1', 'p2']))
    await a.importCollection([photo('p3')], collection('c2', ['p2', 'p3']))
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    expect(await b.getCollection('c1')).toBeDefined()
  }

  it('A removes; the file goes to the trash and B keeps its copy, local-only, out of the sync', async () => {
    await bothSynced()
    const c1File = collectionFile('c1')
    await a.setLocalOnly('c1', true)

    await engineFor(a, drive).run()
    expect(status().state).toBe('idle')
    expect(drive.files.get(c1File.id)?.trashed).toBe(true)
    expect((await libraryOnDrive()).detached.collection).toEqual({ c1: NOW })
    // Never removed from the device that removed it.
    expect(await a.getCollection('c1')).toEqual(collection('c1', ['p1', 'p2']))
    expect((await a.getSyncStates()).c1).toMatchObject({ localOnly: true })
    expect((await a.getSyncStates()).c1?.remoteFileId).toBeUndefined()
    expect(await a.getPhoto('p1')).toBeDefined()

    await engineFor(b, drive).run()
    expect(status().state).toBe('idle')
    expect(await b.getCollection('c1')).toEqual(collection('c1', ['p1', 'p2']))
    expect(await b.getPhoto('p1')).toBeDefined()
    const stateB = (await b.getSyncStates()).c1
    expect(stateB).toMatchObject({ localOnly: true })
    expect(stateB?.remoteFileId).toBeUndefined()
    expect(stateB?.remoteVersion).toBeUndefined()
    expect(status().changedIds).toContain('c1')
    expect((await b.listCollections()).find((c) => c.id === 'c1')?.localOnly).toBe(true)

    // Later passes upload nothing of it, from either device, even after an edit.
    await b.saveCollection(collection('c1', ['p1', 'p2'], { name: 'De B', updatedAt: 2000 }))
    await a.saveCollection(collection('c1', ['p1', 'p2'], { name: 'De A', updatedAt: 2000 }))
    const before = drive.files.size
    await engineFor(b, drive).run()
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    expect(status().state).toBe('idle')
    expect(drive.files.size).toBe(before)
    expect(collectionIdsOnDrive()).toEqual(['c2'])
    expect((await b.getCollection('c1'))?.name).toBe('De B')
    expect((await a.getCollection('c1'))?.name).toBe('De A')
  })

  it.each([
    ['created', false],
    ['updated', true],
  ])(
    'a removal whose library upload (%s) fails trashes nothing; the next pass completes it',
    async (_, hasLibrary) => {
      // With a size, library.json exists already and is updated; without, it is created.
      if (hasLibrary) await a.saveSize({ id: 's1', name: '3x4', widthMm: 30, heightMm: 40 })
      await bothSynced()
      const c1File = collectionFile('c1')
      const library = filesOf(drive, 'library')[0]
      expect(library !== undefined).toBe(hasLibrary)
      await a.setLocalOnly('c1', true)
      const trashed: string[] = []
      const watching: Drive = {
        ...drive,
        trash: (id) => {
          trashed.push(id)
          return drive.trash(id)
        },
      }
      const down = new DriveError('offline', 'down')
      await engineFor(
        a,
        library
          ? failingOnce(watching, 'update', down, (id) => id === library.id)
          : failingOnce(watching, 'create', down, (_folder, name) => name === 'library.json'),
      ).run()
      expect(status().state).toBe('offline')
      expect(trashed).toEqual([])
      expect(drive.files.get(c1File.id)?.trashed).toBe(false)
      expect((await a.getSyncStates()).c1).toMatchObject({
        localOnly: true,
        remoteFileId: c1File.id,
      })

      await engineFor(a, watching).run()
      expect(status().state).toBe('idle')
      expect(trashed[0]).toBe(c1File.id)
      expect(drive.files.get(c1File.id)?.trashed).toBe(true)
      expect((await a.getSyncStates()).c1?.remoteFileId).toBeUndefined()
    },
  )

  it('a removal whose trash fails keeps the file known, and the next pass trashes it', async () => {
    await bothSynced()
    const c1File = collectionFile('c1')
    await a.setLocalOnly('c1', true)
    await engineFor(a, failingOnce(drive, 'trash', new DriveError('offline', 'down'))).run()
    expect(status().state).toBe('offline')
    expect((await a.getSyncStates()).c1?.remoteFileId).toBe(c1File.id)
    // The record is on the Drive while the file is still there: B goes on syncing it.
    await engineFor(b, drive).run()
    expect((await b.getSyncStates()).c1?.localOnly).toBeUndefined()

    await engineFor(a, drive).run()
    expect(status().state).toBe('idle')
    expect(drive.files.get(c1File.id)?.trashed).toBe(true)
    expect((await a.getSyncStates()).c1?.remoteFileId).toBeUndefined()
    await engineFor(b, drive).run()
    expect((await b.getSyncStates()).c1?.localOnly).toBe(true)
  })

  it('A sends again; it goes up, and B stays local-only with its own copy', async () => {
    await bothSynced()
    await a.setLocalOnly('c1', true)
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    await b.saveCollection(collection('c1', ['p1', 'p2'], { name: 'De B', updatedAt: 2000 }))

    await a.setLocalOnly('c1', false)
    await engineFor(a, drive).run()
    expect(status().state).toBe('idle')
    const files = filesOf(drive, 'collection').filter((f) => f.appProperties.collectionId === 'c1')
    expect(files).toHaveLength(1)
    expect((await a.getSyncStates()).c1).toMatchObject({ dirty: false, remoteFileId: files[0]!.id })
    expect((await a.getSyncStates()).c1?.localOnly).toBeUndefined()
    // The record is dropped, and the photo trashed with the removal is back.
    expect((await libraryOnDrive()).detached.collection).toEqual({})
    expect(photoIdsOnDrive()).toEqual(['p1', 'p2', 'p3'])

    for (let i = 0; i < 2; i++) {
      await engineFor(b, drive).run()
      expect(status().state).toBe('idle')
      expect((await b.getCollection('c1'))?.name).toBe('De B')
      expect((await b.getSyncStates()).c1).toMatchObject({ localOnly: true, dirty: true })
      expect((await b.getSyncStates()).c1?.remoteFileId).toBeUndefined()
    }
    expect(JSON.parse(await files[0]!.body.text())).toMatchObject({ name: 'Colecao c1' })

    // Not even a deletion from A removes B's local-only copy.
    await a.deleteCollection('c1')
    await engineFor(a, drive).run()
    expect(collectionIdsOnDrive()).toEqual(['c2'])
    await engineFor(b, drive).run()
    expect(status().state).toBe('idle')
    expect((await b.getCollection('c1'))?.name).toBe('De B')
    expect(await b.getPhoto('p1')).toBeDefined()
  })

  it('a photo shared with another synced collection stays; one used only by the removed one goes', async () => {
    await bothSynced()
    await a.setLocalOnly('c1', true)
    await engineFor(a, drive).run()
    // p2 is also in c2; p1 was only in c1.
    expect(photoIdsOnDrive()).toEqual(['p2', 'p3'])
    // Photos never leave a device.
    expect(await a.getPhoto('p1')).toBeDefined()
    await engineFor(b, drive).run()
    expect(status().state).toBe('idle')
    expect(await b.getPhoto('p1')).toBeDefined()
  })

  it('a photo a collection pulled in the same pass uses stays', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    await engineFor(b, drive).run()
    await b.saveCollection(collection('c3', ['p1']))
    await engineFor(b, drive).run()
    // A pulls c3 in the same pass that removes c1.
    await a.setLocalOnly('c1', true)
    await engineFor(a, drive).run()
    expect(status().state).toBe('idle')
    expect(await a.getCollection('c3')).toBeDefined()
    expect(photoIdsOnDrive()).toEqual(['p1'])
  })

  it('keeps every photo while a collection on the Drive is not known here', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await engineFor(a, drive).run()
    // A second file of c1 from elsewhere: this device never reads it.
    await drive.create(
      await drive.ensureFolder(),
      'collection-c1.json',
      new Blob([JSON.stringify(collection('c1', ['p1']))], { type: 'application/json' }),
      { kind: 'collection', collectionId: 'c1' },
    )
    await a.setLocalOnly('c1', true)
    await engineFor(a, drive).run()
    expect(status().state).toBe('idle')
    expect(collectionIdsOnDrive()).toEqual(['c1'])
    expect(photoIdsOnDrive()).toEqual(['p1'])
  })

  it('a local-only collection never uploads its photos', async () => {
    await a.importCollection([photo('p1')], collection('c1', ['p1']))
    await a.setLocalOnly('c1', true)
    await engineFor(a, drive).run()
    expect(status().state).toBe('idle')
    expect(filesOf(drive, 'photo')).toEqual([])
    expect(filesOf(drive, 'collection')).toEqual([])
  })
})
