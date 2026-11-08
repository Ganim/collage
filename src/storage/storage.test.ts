// @vitest-environment node
import 'fake-indexeddb/auto'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Collection } from '../core/types'
import { exportBundle, importBundle } from './bundle'
import { createIdbStore } from './indexeddb'
import { StorageFullError, type Store, type StoredPhoto } from './store'

const HEX = (c: string) => c.repeat(64)

function photo(id: string): StoredPhoto {
  return {
    id,
    width: 400,
    height: 300,
    name: `${id.slice(0, 4)}.jpg`,
    original: new Blob([`orig-${id}`], { type: 'image/png' }),
    preview: new Blob([`prev-${id}`], { type: 'image/jpeg' }),
    thumb: new Blob([`thumb-${id}`], { type: 'image/jpeg' }),
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
    const c = collection('c1', [HEX('a')])
    await store.saveCollection(c)
    expect(await store.getCollection('c1')).toEqual(c)
    expect(await store.listCollections()).toEqual([
      { id: 'c1', name: c.name, updatedAt: 1000, frameCount: 1 },
    ])
  })

  it('stores photos with blobs and returns metadata without them', async () => {
    await store.putPhoto(photo(HEX('a')))
    const got = await store.getPhoto(HEX('a'))
    expect(await got!.original.text()).toBe(`orig-${HEX('a')}`)
    expect(await store.getPhotosMeta([HEX('a'), HEX('z')])).toEqual({
      [HEX('a')]: { id: HEX('a'), width: 400, height: 300, name: 'aaaa.jpg' },
    })
  })

  it('deleteCollection keeps a photo used by another collection and removes the unused one', async () => {
    await store.putPhoto(photo(HEX('a')))
    await store.putPhoto(photo(HEX('b')))
    await store.saveCollection(collection('c1', [HEX('a'), HEX('b')]))
    await store.saveCollection(collection('c2', [HEX('a')]))
    await store.deleteCollection('c1')
    expect(await store.getCollection('c1')).toBeUndefined()
    expect(await store.getPhoto(HEX('a'))).toBeDefined()
    expect(await store.getPhoto(HEX('b'))).toBeUndefined()
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
    await expect(store.putPhoto(photo(HEX('a')))).rejects.toBeInstanceOf(StorageFullError)
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
    await store.putPhoto(photo(HEX('a')))
    await store.putPhoto(photo(HEX('b')))
    const original = collection('c1', [HEX('a'), HEX('b')])
    await store.saveCollection(original)

    const file = await exportBundle(store, 'c1')
    const target = await createIdbStore(`test-${dbCount++}`)
    const imported = await importBundle(target, file)

    expect(imported.id).not.toBe('c1')
    expect(imported).toEqual({ ...original, id: imported.id })
    expect(await target.getCollection(imported.id)).toEqual(imported)
    const got = await target.getPhoto(HEX('b'))
    expect(got).toMatchObject({ width: 400, height: 300, name: 'bbbb.jpg' })
    expect(await got!.original.text()).toBe(`orig-${HEX('b')}`)
    expect(got!.original.type).toBe('image/png')
    expect(await got!.preview.text()).toBe(`prev-${HEX('b')}`)
    expect(await got!.thumb.text()).toBe(`thumb-${HEX('b')}`)
  })

  it('exporting a missing collection rejects', async () => {
    await expect(exportBundle(store, 'nope')).rejects.toThrow(Error)
  })

  async function unzipExport(): Promise<Record<string, Uint8Array>> {
    await store.putPhoto(photo(HEX('a')))
    await store.putPhoto(photo(HEX('b')))
    await store.saveCollection(collection('c1', [HEX('a'), HEX('b')]))
    return unzipSync(new Uint8Array(await (await exportBundle(store, 'c1')).arrayBuffer()))
  }

  async function expectRejectsWithoutWriting(file: Blob) {
    const target = await createIdbStore(`test-${dbCount++}`)
    await expect(importBundle(target, file)).rejects.toThrow(Error)
    expect(await target.listCollections()).toEqual([])
    expect(await target.getPhoto(HEX('a'))).toBeUndefined()
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
    delete files[`photos/${HEX('b')}/thumb`]
    await expectRejectsWithoutWriting(new Blob([zipSync(files) as BlobPart]))
  })
})
