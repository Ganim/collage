import { describe, expect, it } from 'vitest'
import { forgetCollectionDeletion, mergeLibrary, type LibraryFile } from './library'
import type { SavedSize } from '../core/types'

const size = (id: string, updatedAt?: number, extra: Partial<SavedSize> = {}): SavedSize =>
  ({ id, name: id, w: 10, h: 10, unit: 'cm', updatedAt, ...extra }) as unknown as SavedSize
const lib = (over: Partial<LibraryFile> = {}): LibraryFile => ({
  sizes: [],
  folders: [],
  deleted: { size: {}, folder: {}, collection: {} },
  ...over,
})
const deleted = (d: Partial<LibraryFile['deleted']>) => ({
  size: {},
  folder: {},
  collection: {},
  ...d,
})

describe('mergeLibrary', () => {
  it('keeps the local library when there is no remote', () => {
    const local = lib({ sizes: [size('s1', 1)] })
    expect(mergeLibrary(local, null)).toEqual(local)
  })

  it('unions items that exist on one side only', () => {
    const m = mergeLibrary(lib({ sizes: [size('b', 1)] }), lib({ sizes: [size('a', 1)] }))
    expect(m.sizes.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('the newer updatedAt wins per id', () => {
    const m = mergeLibrary(
      lib({ sizes: [size('s', 5, { name: 'local' })] }),
      lib({ sizes: [size('s', 9, { name: 'remote' })] }),
    )
    expect(m.sizes).toHaveLength(1)
    expect(m.sizes[0]!.name).toBe('remote')
  })

  it('items without updatedAt count as 0', () => {
    const m = mergeLibrary(
      lib({ sizes: [size('s', undefined, { name: 'old' })] }),
      lib({ sizes: [size('s', 1, { name: 'new' })] }),
    )
    expect(m.sizes[0]!.name).toBe('new')
  })

  it('a remote tombstone newer than the local item removes it', () => {
    const m = mergeLibrary(
      lib({ sizes: [size('s', 5)] }),
      lib({ deleted: deleted({ size: { s: 8 } }) }),
    )
    expect(m.sizes).toEqual([])
    expect(m.deleted.size).toEqual({ s: 8 })
  })

  it('a local tombstone newer than the remote item removes it', () => {
    const m = mergeLibrary(
      lib({ deleted: deleted({ size: { s: 8 } }) }),
      lib({ sizes: [size('s', 5)] }),
    )
    expect(m.sizes).toEqual([])
  })

  it('an item newer than the tombstone survives and drops the tombstone', () => {
    const m = mergeLibrary(
      lib({ sizes: [size('s', 9)] }),
      lib({ deleted: deleted({ size: { s: 8 } }) }),
    )
    expect(m.sizes.map((s) => s.id)).toEqual(['s'])
    expect(m.deleted.size).toEqual({})
  })

  it('a remote item newer than the local tombstone survives', () => {
    const m = mergeLibrary(
      lib({ deleted: deleted({ size: { s: 3 } }) }),
      lib({ sizes: [size('s', 9)] }),
    )
    expect(m.sizes.map((s) => s.id)).toEqual(['s'])
    expect(m.deleted.size).toEqual({})
  })

  it('merges tombstones taking the max timestamp per id, including collections', () => {
    const m = mergeLibrary(
      lib({ deleted: deleted({ collection: { c: 4, d: 1 } }) }),
      lib({ deleted: deleted({ collection: { c: 7 } }) }),
    )
    expect(m.deleted.collection).toEqual({ c: 7, d: 1 })
  })

  it('a deleted folder clears folderId from its sizes and keeps their updatedAt', () => {
    const m = mergeLibrary(
      lib({
        sizes: [size('s', 5, { folderId: 'f' })],
        folders: [{ id: 'f', name: 'F', createdAt: 1, updatedAt: 2 }],
      }),
      lib({ deleted: deleted({ folder: { f: 6 } }) }),
    )
    expect(m.folders).toEqual([])
    expect('folderId' in m.sizes[0]!).toBe(false)
    expect(m.sizes[0]!.updatedAt).toBe(5)
  })

  it('sorts folders by id', () => {
    const m = mergeLibrary(
      lib({
        folders: [
          { id: 'z', name: 'z', createdAt: 1 },
          { id: 'y', name: 'y', createdAt: 1 },
        ],
      }),
      null,
    )
    expect(m.folders.map((f) => f.id)).toEqual(['y', 'z'])
  })

  it('on equal timestamps the item wins over the tombstone', () => {
    const m = mergeLibrary(
      lib({ sizes: [size('s', 8)] }),
      lib({ deleted: deleted({ size: { s: 8 } }) }),
    )
    expect(m.sizes.map((s) => s.id)).toEqual(['s'])
    expect(m.deleted.size).toEqual({})
  })

  it('a deleted folder clears folderId even from sizes newer than the tombstone', () => {
    const m = mergeLibrary(
      lib({
        sizes: [size('s', 9, { folderId: 'f' })],
        folders: [{ id: 'f', name: 'F', createdAt: 1, updatedAt: 2 }],
      }),
      lib({ deleted: deleted({ folder: { f: 6 } }) }),
    )
    expect(m.sizes).toHaveLength(1)
    expect('folderId' in m.sizes[0]!).toBe(false)
    expect(m.sizes[0]!.updatedAt).toBe(9)
  })
})

describe('forgetCollectionDeletion', () => {
  it('removes only that collection record and leaves the input untouched', () => {
    const l = lib({ deleted: deleted({ collection: { a: 1, b: 2 }, size: { s: 3 } }) })
    const out = forgetCollectionDeletion(l, 'a')
    expect(out.deleted).toEqual({ size: { s: 3 }, folder: {}, collection: { b: 2 } })
    expect(l.deleted.collection).toEqual({ a: 1, b: 2 })
  })
})
