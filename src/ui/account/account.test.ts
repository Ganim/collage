import { describe, expect, it, vi } from 'vitest'
import { loadAccount, signOut, type Account } from './account'

const KEY = 'collage.account'
const saved: Account = { email: 'ana@exemplo.com', name: 'Ana', picture: null }

function memoryStorage(initial?: Account): Storage {
  const data = new Map<string, string>()
  if (initial) data.set(KEY, JSON.stringify(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  }
}

const respond = (status: number, body?: unknown) =>
  vi.fn<typeof fetch>(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  )
const offline = () =>
  vi.fn<typeof fetch>(async () => {
    throw new TypeError('Load failed')
  })

describe('loadAccount', () => {
  it('401 clears the saved account and returns null', async () => {
    const storage = memoryStorage(saved)
    expect(await loadAccount(respond(401), storage)).toBeNull()
    expect(storage.getItem(KEY)).toBeNull()
  })

  it('network error with a saved account returns it', async () => {
    expect(await loadAccount(offline(), memoryStorage(saved))).toEqual(saved)
  })

  it('network error without a saved account returns null', async () => {
    expect(await loadAccount(offline(), memoryStorage())).toBeNull()
  })

  it('200 saves and returns the account', async () => {
    const storage = memoryStorage()
    const fresh = { email: 'bia@exemplo.com', name: 'Bia', picture: 'https://foto/bia.jpg' }
    expect(await loadAccount(respond(200, fresh), storage)).toEqual(fresh)
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(fresh)
  })

  it('500 with a saved account returns it', async () => {
    const storage = memoryStorage(saved)
    expect(await loadAccount(respond(500), storage)).toEqual(saved)
    expect(storage.getItem(KEY)).not.toBeNull()
  })

  it('works where AbortSignal.timeout does not exist (Safari before 16)', async () => {
    const timeout = AbortSignal.timeout
    // @ts-expect-error removing it, as older Safari lacks it
    delete AbortSignal.timeout
    try {
      const storage = memoryStorage()
      const fresh = { email: 'bia@exemplo.com', name: 'Bia', picture: null }
      expect(await loadAccount(respond(200, fresh), storage)).toEqual(fresh)
    } finally {
      AbortSignal.timeout = timeout
    }
  })

  it('a connection that never answers counts as offline', async () => {
    vi.useFakeTimers()
    try {
      const hanging = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('', 'AbortError')),
            ),
          ),
      )
      const result = loadAccount(hanging, memoryStorage(saved))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await result).toEqual(saved)
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks the service without a cached answer', async () => {
    const fetchFn = respond(401)
    await loadAccount(fetchFn, memoryStorage())
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })
})

describe('signOut', () => {
  it('signOut clears the saved account even offline', async () => {
    const storage = memoryStorage(saved)
    const fetchFn = offline()
    await signOut(fetchFn, storage)
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(storage.getItem(KEY)).toBeNull()
  })
})
