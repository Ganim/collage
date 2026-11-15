import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DriveAuthError,
  DriveNetworkError,
  clearDriveToken,
  getDriveToken,
  hasProvisionalId,
  loadAccount,
  signOut,
  type Account,
} from './account'

const KEY = 'collage.account'
const saved: Account = {
  id: 'sub-ana',
  email: 'ana@exemplo.com',
  name: 'Ana',
  picture: null,
  drive: true,
}

function memoryStorage(initial?: object): Storage {
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
    const fresh = {
      id: 'sub-bia',
      email: 'bia@exemplo.com',
      name: 'Bia',
      picture: 'https://foto/bia.jpg',
      drive: true,
    }
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
      const fresh = {
        id: 'sub-bia',
        email: 'bia@exemplo.com',
        name: 'Bia',
        picture: null,
        drive: false,
      }
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

  it('reads an account saved before ids and Drive existed as id = email, drive off', async () => {
    const old = { email: 'ana@exemplo.com', name: 'Ana', picture: null }
    expect(await loadAccount(offline(), memoryStorage(old))).toEqual({
      ...old,
      id: 'ana@exemplo.com',
      drive: false,
    })
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

describe('getDriveToken', () => {
  const NOW = 1_000_000_000_000
  const ok = (accessToken: string, expiresIn = 3600) => respond(200, { accessToken, expiresIn })

  beforeEach(() => {
    clearDriveToken()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('returns the token with its expiry and asks the service with the session', async () => {
    const fetchFn = ok('t1')
    expect(await getDriveToken(fetchFn)).toEqual({
      accessToken: 't1',
      expiresAt: NOW + 3600_000,
    })
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/auth/drive-token',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
  })

  it('reuses the token while it is valid', async () => {
    const fetchFn = ok('t1')
    await getDriveToken(fetchFn)
    vi.setSystemTime(NOW + 3500_000)
    expect((await getDriveToken(fetchFn)).accessToken).toBe('t1')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('asks again within 60 s of the expiry', async () => {
    await getDriveToken(ok('t1'))
    vi.setSystemTime(NOW + 3541_000)
    const next = ok('t2')
    expect((await getDriveToken(next)).accessToken).toBe('t2')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('force skips a still-valid cached token', async () => {
    await getDriveToken(ok('t1'))
    const next = ok('t2')
    expect((await getDriveToken(next, true)).accessToken).toBe('t2')
    expect(next).toHaveBeenCalledTimes(1)
    expect((await getDriveToken(ok('t3'))).accessToken).toBe('t2')
  })

  it('clearDriveToken forces a new request, and signOut clears it', async () => {
    await getDriveToken(ok('t1'))
    clearDriveToken()
    expect((await getDriveToken(ok('t2'))).accessToken).toBe('t2')
    await signOut(offline(), memoryStorage())
    expect((await getDriveToken(ok('t3'))).accessToken).toBe('t3')
  })

  it.each([
    [401, undefined, 'signed_out'],
    [403, { error: 'no_drive' }, 'no_drive'],
    [403, { error: 'revoked' }, 'revoked'],
  ])('%i %j is a DriveAuthError (%s)', async (status, body, reason) => {
    const error = await getDriveToken(respond(status, body)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DriveAuthError)
    expect((error as DriveAuthError).reason).toBe(reason)
  })

  it('502 is a plain error; a network failure is a DriveNetworkError', async () => {
    const refused = await getDriveToken(respond(502, { error: 'google' })).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(Error)
    expect(refused).not.toBeInstanceOf(DriveAuthError)
    expect(refused).not.toBeInstanceOf(DriveNetworkError)
    const unreachable = await getDriveToken(offline()).catch((e: unknown) => e)
    expect(unreachable).toBeInstanceOf(DriveNetworkError)
    expect(unreachable).not.toBeInstanceOf(DriveAuthError)
  })

  /** A fetch whose answers the test releases one by one, by call index. */
  function deferred() {
    const pending: ((r: Response) => void)[] = []
    const fetchFn = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => pending.push(resolve)),
    )
    const answer = (i: number, accessToken: string) =>
      pending[i]!(new Response(JSON.stringify({ accessToken, expiresIn: 3600 }), { status: 200 }))
    return { fetchFn, answer }
  }

  it('concurrent calls share the request in flight', async () => {
    const { fetchFn, answer } = deferred()
    const first = getDriveToken(fetchFn)
    const second = getDriveToken(fetchFn)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    answer(0, 't1')
    expect((await first).accessToken).toBe('t1')
    expect((await second).accessToken).toBe('t1')
  })

  it('a failed shared request lets the next call ask again', async () => {
    const failing = offline()
    const results = await Promise.all([
      getDriveToken(failing).catch((e: unknown) => e),
      getDriveToken(failing).catch((e: unknown) => e),
    ])
    expect(failing).toHaveBeenCalledTimes(1)
    expect(results[0]).toBe(results[1])
    expect((await getDriveToken(ok('t2'))).accessToken).toBe('t2')
  })

  it('force starts a new request that replaces the shared one', async () => {
    const { fetchFn, answer } = deferred()
    const stale = getDriveToken(fetchFn)
    const forced = getDriveToken(fetchFn, true)
    const joined = getDriveToken(fetchFn)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    answer(1, 'fresh')
    expect((await forced).accessToken).toBe('fresh')
    expect((await joined).accessToken).toBe('fresh')
    // The replaced request still answers its own caller but never overwrites the cache.
    answer(0, 'old')
    expect((await stale).accessToken).toBe('old')
    expect((await getDriveToken(fetchFn)).accessToken).toBe('fresh')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('clearDriveToken drops the request in flight too', async () => {
    const { fetchFn, answer } = deferred()
    const before = getDriveToken(fetchFn)
    clearDriveToken()
    const after = ok('after')
    const next = getDriveToken(after)
    answer(0, 'before-sign-out')
    await before
    expect((await next).accessToken).toBe('after')
    expect((await getDriveToken(after)).accessToken).toBe('after')
    expect(after).toHaveBeenCalledTimes(1)
  })
})

describe('hasProvisionalId', () => {
  it('is true only while the id is the e-mail standing in for it', async () => {
    const old = await loadAccount(
      offline(),
      memoryStorage({ email: 'ana@exemplo.com', name: 'Ana' }),
    )
    expect(old && hasProvisionalId(old)).toBe(true)
    expect(hasProvisionalId(saved)).toBe(false)
  })
})
