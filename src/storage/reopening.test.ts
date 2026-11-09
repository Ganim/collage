import { describe, expect, it, vi } from 'vitest'
import { reopeningStore } from './reopening'
import { StorageFullError, type Store } from './store'

const lost = () => new DOMException('The database connection is closing.', 'InvalidStateError')

function fakeStore(getLastCollectionId: () => Promise<string | undefined>): Store {
  return { getLastCollectionId } as unknown as Store
}

describe('reopeningStore', () => {
  it('reopens the database and repeats the call when the connection was lost', async () => {
    const open = vi
      .fn<() => Promise<Store>>()
      .mockResolvedValueOnce(fakeStore(() => Promise.reject(lost())))
      .mockResolvedValueOnce(fakeStore(() => Promise.resolve('a')))
    await expect(reopeningStore(open).getLastCollectionId()).resolves.toBe('a')
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('opens the database once while it keeps working', async () => {
    const open = vi.fn(() => Promise.resolve(fakeStore(() => Promise.resolve('a'))))
    const store = reopeningStore(open)
    await store.getLastCollectionId()
    await store.getLastCollectionId()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('tries to open again after an open that failed', async () => {
    const open = vi
      .fn<() => Promise<Store>>()
      .mockRejectedValueOnce(new Error('no database'))
      .mockResolvedValueOnce(fakeStore(() => Promise.resolve('a')))
    const store = reopeningStore(open)
    await expect(store.getLastCollectionId()).rejects.toThrow('no database')
    await expect(store.getLastCollectionId()).resolves.toBe('a')
  })

  it('does not repeat a call that failed for another reason', async () => {
    const call = vi.fn(() => Promise.reject(new StorageFullError()))
    const open = vi.fn(() => Promise.resolve(fakeStore(call)))
    await expect(reopeningStore(open).getLastCollectionId()).rejects.toThrow(StorageFullError)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('gives up after one repeat', async () => {
    const open = vi.fn(() => Promise.resolve(fakeStore(() => Promise.reject(lost()))))
    await expect(reopeningStore(open).getLastCollectionId()).rejects.toThrow('closing')
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('does not look like a promise', () => {
    expect((reopeningStore(vi.fn()) as unknown as { then: unknown }).then).toBeUndefined()
  })
})
