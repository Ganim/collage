import { describe, expect, it, vi } from 'vitest'
import { DriveAuthError } from '../ui/account/account'
import { DriveError, createDrive } from './drive'

const API = 'https://www.googleapis.com'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function setup(
  handler: Handler,
  getToken: (force?: boolean) => Promise<string> = vi.fn(async () => 'tok'),
) {
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) =>
    handler(String(input), init),
  )
  const drive = createDrive(getToken, fetchFn as unknown as typeof fetch)
  return { drive, fetchFn, getToken }
}

const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

describe('ensureFolder', () => {
  it('finds the folder in the root and caches the id', async () => {
    const { drive, fetchFn } = setup(() => json(200, { files: [{ id: 'F1' }] }))
    expect(await drive.ensureFolder()).toBe('F1')
    expect(await drive.ensureFolder()).toBe('F1')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchFn.mock.calls[0]![0]))
    expect(url.origin + url.pathname).toBe(`${API}/drive/v3/files`)
    expect(url.searchParams.get('q')).toBe(
      "name='Collage' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false",
    )
    expect(header(fetchFn.mock.calls[0]![1]!, 'authorization')).toBe('Bearer tok')
  })

  it('creates the folder once when called concurrently, and retries after a failure', async () => {
    let posts = 0
    let fail = true
    const { drive } = setup((_url, init) => {
      if (init.method === 'POST') {
        posts++
        return json(200, { id: 'NEW' })
      }
      if (fail) return json(500, {})
      return json(200, { files: [] })
    })
    await expect(drive.ensureFolder()).rejects.toMatchObject({ kind: 'other' })
    fail = false
    const [a, b] = await Promise.all([drive.ensureFolder(), drive.ensureFolder()])
    expect([a, b]).toEqual(['NEW', 'NEW'])
    expect(posts).toBe(1)
  })

  it('creates the folder when absent', async () => {
    const { drive, fetchFn } = setup((_url, init) =>
      init.method === 'POST' ? json(200, { id: 'NEW' }) : json(200, { files: [] }),
    )
    expect(await drive.ensureFolder()).toBe('NEW')
    const [url, init] = fetchFn.mock.calls[1]!
    expect(String(url).startsWith(`${API}/drive/v3/files`)).toBe(true)
    expect(JSON.parse(String(init!.body))).toEqual({
      name: 'Collage',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root'],
    })
  })
})

describe('list', () => {
  it('follows nextPageToken through every page', async () => {
    const { drive, fetchFn } = setup((url) => {
      const token = new URL(url).searchParams.get('pageToken')
      return token
        ? json(200, { files: [{ id: 'b', name: 'B', version: '2', md5Checksum: 'm5' }] })
        : json(200, {
            nextPageToken: 'P2',
            files: [{ id: 'a', name: 'A', version: '1', appProperties: { k: 'v' } }],
          })
    })
    expect(await drive.list('FOLDER')).toEqual([
      { id: 'a', name: 'A', version: '1', appProperties: { k: 'v' } },
      { id: 'b', name: 'B', version: '2', appProperties: {}, md5Checksum: 'm5' },
    ])
    const first = new URL(String(fetchFn.mock.calls[0]![0]))
    expect(first.searchParams.get('q')).toBe("'FOLDER' in parents and trashed=false")
    expect(first.searchParams.get('fields')).toBe(
      'nextPageToken,files(id,name,version,appProperties,md5Checksum)',
    )
    expect(first.searchParams.get('pageSize')).toBe('1000')
    expect(new URL(String(fetchFn.mock.calls[1]![0])).searchParams.get('pageToken')).toBe('P2')
  })
})

describe('create and update (resumable)', () => {
  it('POSTs the metadata, then PUTs the bytes to the Location', async () => {
    const { drive, fetchFn } = setup((_url, init) =>
      init.method === 'POST'
        ? new Response(null, { status: 200, headers: { location: 'https://up.example/session1' } })
        : json(200, { id: 'X', name: 'photo-1', version: '1', appProperties: { a: 'b' } }),
    )
    const body = new Blob(['hello'], { type: 'image/png' })
    const file = await drive.create('FOLDER', 'photo-1', body, { a: 'b' })
    expect(file).toEqual({ id: 'X', name: 'photo-1', version: '1', appProperties: { a: 'b' } })
    const [postUrl, post] = fetchFn.mock.calls[0]!
    const u = new URL(String(postUrl))
    expect(u.origin + u.pathname).toBe(`${API}/upload/drive/v3/files`)
    expect(u.searchParams.get('uploadType')).toBe('resumable')
    expect(u.searchParams.get('fields')).toBe('id,name,version,appProperties')
    expect(post!.method).toBe('POST')
    expect(JSON.parse(String(post!.body))).toEqual({
      name: 'photo-1',
      parents: ['FOLDER'],
      appProperties: { a: 'b' },
      mimeType: 'image/png',
    })
    const [putUrl, put] = fetchFn.mock.calls[1]!
    expect(String(putUrl)).toBe('https://up.example/session1')
    expect(put!.method).toBe('PUT')
    expect(put!.body).toBe(body)
  })

  it('update PATCHes the upload endpoint, then PUTs', async () => {
    const { drive, fetchFn } = setup((_u, init) =>
      init.method === 'PATCH'
        ? new Response(null, { status: 200, headers: { location: 'https://up.example/s2' } })
        : json(200, { id: 'X', name: 'n', version: '7' }),
    )
    const file = await drive.update('X', new Blob(['z']))
    expect(file.version).toBe('7')
    const [url, init] = fetchFn.mock.calls[0]!
    const u = new URL(String(url))
    expect(u.origin + u.pathname).toBe(`${API}/upload/drive/v3/files/X`)
    expect(u.searchParams.get('uploadType')).toBe('resumable')
    expect(init!.method).toBe('PATCH')
    expect(String(fetchFn.mock.calls[1]![0])).toBe('https://up.example/s2')
  })

  it('fails as other when the session has no Location', async () => {
    const { drive } = setup(() => new Response(null, { status: 200 }))
    await expect(drive.create('F', 'n', new Blob(['x']), {})).rejects.toMatchObject({
      kind: 'other',
    })
  })
})

describe('download and trash', () => {
  it('downloads with alt=media', async () => {
    const { drive, fetchFn } = setup(() => new Response('bytes'))
    const blob = await drive.download('X')
    expect(await blob.text()).toBe('bytes')
    expect(String(fetchFn.mock.calls[0]![0])).toBe(`${API}/drive/v3/files/X?alt=media`)
  })

  it('trashes with PATCH {"trashed":true}', async () => {
    const { drive, fetchFn } = setup(() => json(200, { id: 'X' }))
    await drive.trash('X')
    const [url, init] = fetchFn.mock.calls[0]!
    expect(String(url).startsWith(`${API}/drive/v3/files/X`)).toBe(true)
    expect(init!.method).toBe('PATCH')
    expect(JSON.parse(String(init!.body))).toEqual({ trashed: true })
  })
})

describe('401 handling', () => {
  it('asks for a fresh token once and repeats the request', async () => {
    let calls = 0
    const getToken = vi.fn(async (force?: boolean) => (force ? 'fresh' : 'old'))
    const { drive } = setup((_u, init) => {
      calls++
      return header(init, 'authorization') === 'Bearer fresh'
        ? json(200, { files: [{ id: 'F' }] })
        : json(401, {})
    }, getToken)
    expect(await drive.ensureFolder()).toBe('F')
    expect(calls).toBe(2)
    expect(getToken.mock.calls).toEqual([[], [true]])
  })

  it('maps a second 401 to revoked', async () => {
    const { drive, fetchFn } = setup(() => json(401, {}))
    await expect(drive.ensureFolder()).rejects.toMatchObject({
      name: 'DriveError',
      kind: 'revoked',
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('error mapping', () => {
  const quota = (status: number) =>
    json(status, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } })

  it.each([403, 429])('maps %i storageQuotaExceeded to full', async (status) => {
    const { drive } = setup(() => quota(status))
    await expect(drive.list('F')).rejects.toMatchObject({ kind: 'full' })
  })

  it('maps a quota error on the upload step to full', async () => {
    const { drive } = setup((_u, init) =>
      init.method === 'POST'
        ? new Response(null, { headers: { location: 'https://up.example/s' } })
        : quota(403),
    )
    await expect(drive.create('F', 'n', new Blob(['x']), {})).rejects.toMatchObject({
      kind: 'full',
    })
  })

  it('maps a rejected fetch to offline', async () => {
    const { drive } = setup(() => {
      throw new TypeError('Load failed')
    })
    const error = await drive.list('F').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DriveError)
    expect(error).toMatchObject({ kind: 'offline' })
  })

  it('maps other failures to other, with the status but never the token', async () => {
    const { drive } = setup(() => json(500, {}))
    const error = (await drive.list('F').catch((e: unknown) => e)) as DriveError
    expect(error.kind).toBe('other')
    expect(error.message).toContain('500')
    expect(error.message).not.toContain('tok')
    expect(error.status).toBe(500)
  })

  it('carries the HTTP status of a 404 and of a quota error; none when offline', async () => {
    const missing = (await setup(() => json(404, {}))
      .drive.download('x')
      .catch((e: unknown) => e)) as DriveError
    expect(missing).toMatchObject({ kind: 'other', status: 404 })
    await expect(setup(() => quota(403)).drive.list('F')).rejects.toMatchObject({ status: 403 })
    const offline = (await setup(() => {
      throw new TypeError('Load failed')
    })
      .drive.list('F')
      .catch((e: unknown) => e)) as DriveError
    expect(offline.status).toBeUndefined()
  })

  it('a plain 403 without the quota reason is other', async () => {
    const { drive } = setup(() => json(403, { error: { errors: [{ reason: 'forbidden' }] } }))
    await expect(drive.list('F')).rejects.toMatchObject({ kind: 'other' })
  })

  it('maps a 403 insufficientPermissions (Drive left unchecked) to revoked', async () => {
    const { drive } = setup(() =>
      json(403, {
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          errors: [{ reason: 'insufficientPermissions' }],
          status: 'PERMISSION_DENIED',
        },
      }),
    )
    await expect(drive.list('F')).rejects.toMatchObject({ kind: 'revoked', status: 403 })
  })

  it('maps a 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT detail to revoked', async () => {
    const { drive } = setup(() =>
      json(403, {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
            },
          ],
        },
      }),
    )
    await expect(drive.ensureFolder()).rejects.toMatchObject({ kind: 'revoked' })
  })

  it('keeps the reason of a Drive error', async () => {
    const { drive } = setup(() => json(403, { error: { errors: [{ reason: 'forbidden' }] } }))
    await expect(drive.download('x')).rejects.toMatchObject({
      kind: 'other',
      status: 403,
      reason: 'forbidden',
    })
  })

  it('lets a DriveAuthError from getToken through unchanged', async () => {
    const auth = new DriveAuthError('no_drive')
    const { drive, fetchFn } = setup(
      () => json(200, {}),
      vi.fn(async () => {
        throw auth
      }),
    )
    await expect(drive.list('F')).rejects.toBe(auth)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('timeouts', () => {
  // A request that never answers until its signal aborts it, as fetch does.
  const hang = (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      )
    })

  it('gives up on a metadata request after 30 s as offline', async () => {
    vi.useFakeTimers()
    try {
      const { drive } = setup(hang)
      const result = drive.list('F').catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(29_999)
      let settled = false
      void result.then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const error = await result
      expect(error).toBeInstanceOf(DriveError)
      expect(error).toMatchObject({ kind: 'offline' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up on a download that does not start after 30 s', async () => {
    vi.useFakeTimers()
    try {
      const { drive } = setup(hang)
      const result = drive.download('X').catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await result).toMatchObject({ kind: 'offline' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives the upload PUT 120 s', async () => {
    vi.useFakeTimers()
    try {
      const { drive } = setup((url, init) =>
        init.method === 'POST'
          ? new Response(null, { headers: { location: 'https://up.example/s' } })
          : hang(url, init),
      )
      let settled = false
      const result = drive
        .create('F', 'n', new Blob(['x']), {})
        .catch((e: unknown) => e)
        .finally(() => (settled = true))
      await vi.advanceTimersByTimeAsync(119_000)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(await result).toMatchObject({ kind: 'offline' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives a large upload PUT more time: 120 s + 1 s per 25 KB', async () => {
    vi.useFakeTimers()
    try {
      const { drive } = setup((url, init) =>
        init.method === 'POST'
          ? new Response(null, { headers: { location: 'https://up.example/s' } })
          : hang(url, init),
      )
      // 12 MB: 120 s + 480 s.
      const big = new Blob([new Uint8Array(12_000_000)], { type: 'image/jpeg' })
      let settled = false
      const result = drive
        .create('F', 'photo-big', big, {})
        .catch((e: unknown) => e)
        .finally(() => (settled = true))
      await vi.advanceTimersByTimeAsync(121_000)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(600_000 - 121_000 - 1)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await result).toMatchObject({ kind: 'offline' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a request that answers in time is not aborted later', async () => {
    vi.useFakeTimers()
    try {
      const signals: AbortSignal[] = []
      const { drive } = setup((_u, init) => {
        signals.push(init.signal!)
        return new Response('bytes')
      })
      const blob = await drive.download('X')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(signals[0]!.aborted).toBe(false)
      expect(await blob.text()).toBe('bytes')
    } finally {
      vi.useRealTimers()
    }
  })
})
