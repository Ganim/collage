// @vitest-environment node
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Collection } from '../core/types'
import { exportBundle, importBundle } from './bundle'
import { createIdbStore } from './indexeddb'
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
      { id: 'c1', name: c.name, updatedAt: 1000, frameCount: 1 },
    ])
  })

  it('stores photos with blobs and returns metadata without them', async () => {
    await store.putPhoto(photo('a'))
    const got = await store.getPhoto(ID.a)
    expect(await got!.original.text()).toBe('orig-a')
    expect(await store.getPhotosMeta([ID.a, 'z'.repeat(64)])).toEqual({
      [ID.a]: { id: ID.a, width: 400, height: 300, name: `${ID.a.slice(0, 4)}.jpg` },
    })
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
