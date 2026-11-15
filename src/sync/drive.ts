/** Thin fetch client of the Drive REST v3 API, limited to the files this app created (drive.file). */

export interface RemoteFile {
  id: string
  name: string
  /** Drive's version counter: a string of digits that grows with every change. */
  version: string
  appProperties: Record<string, string>
  /** The MD5 of the content as Google computed it; only `list` asks for it. */
  md5Checksum?: string
}

export interface Drive {
  /** The id of the `Collage` folder in the root of the Drive; creates it once. */
  ensureFolder(): Promise<string>
  /** Every non-trashed file in the folder, across all pages. */
  list(folderId: string): Promise<RemoteFile[]>
  download(fileId: string): Promise<Blob>
  create(
    folderId: string,
    name: string,
    body: Blob,
    appProperties: Record<string, string>,
  ): Promise<RemoteFile>
  update(fileId: string, body: Blob): Promise<RemoteFile>
  /** The app never deletes for good: files go to the trash. */
  trash(fileId: string): Promise<void>
}

export type DriveErrorKind = 'full' | 'revoked' | 'offline' | 'other'

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message: string,
    /** The HTTP status, when the Drive answered with an error. */
    readonly status?: number,
    /** The first reason Google gave for the error (e.g. `forbidden`), when it gave one. */
    readonly reason?: string,
  ) {
    super(message)
    this.name = 'DriveError'
  }
}

const API = 'https://www.googleapis.com'
const FOLDER_NAME = 'Collage'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FILE_FIELDS = 'id,name,version,appProperties'

interface RawFile {
  id: string
  name?: string
  version?: string
  appProperties?: Record<string, string>
  md5Checksum?: string
}

function toRemoteFile(raw: RawFile): RemoteFile {
  const file: RemoteFile = {
    id: raw.id,
    name: raw.name ?? '',
    version: String(raw.version ?? ''),
    appProperties: raw.appProperties ?? {},
  }
  if (typeof raw.md5Checksum === 'string') file.md5Checksum = raw.md5Checksum
  return file
}

/** Each request gives up after this long without an answer; a timeout counts as offline. */
const TIMEOUT_MS = 30_000
/**
 * The upload PUT is answered only once the whole body is sent: its limit grows with the body
 * (1 s per 25 KB, about 0.2 Mbps), so a big photo on a slow phone link still gets through.
 */
const UPLOAD_TIMEOUT_MS = 120_000
const UPLOAD_BYTES_PER_SECOND = 25_000

function timeoutFor(init: RequestInit): number {
  if (init.method !== 'PUT') return TIMEOUT_MS
  const size = init.body instanceof Blob ? init.body.size : 0
  return UPLOAD_TIMEOUT_MS + Math.floor(size / UPLOAD_BYTES_PER_SECOND) * 1000
}

/** Reasons that mean the token lacks the Drive permission (left unchecked on the consent screen). */
const SCOPE_REASONS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'])

/** 403 reasons that are only "slow down": the same request is worth trying again later. */
export const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded'])

/** The waits before each repeat of a request the Drive refused for going too fast. */
const RATE_LIMIT_DELAYS_MS = [1000, 2000, 4000]

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The reasons Google put in an error answer, in `error.errors[]` and `error.details[]`. */
async function errorReasons(response: Response): Promise<string[]> {
  try {
    const body = (await response.clone().json()) as {
      error?: {
        status?: unknown
        errors?: { reason?: unknown }[]
        details?: { reason?: unknown }[]
      }
    }
    const error = body.error
    return [...(error?.errors ?? []), ...(error?.details ?? []), { reason: error?.status }]
      .map((e) => e?.reason)
      .filter((r): r is string => typeof r === 'string')
  } catch {
    return []
  }
}

/**
 * `getToken(true)` must return a token that skips any cache; it is asked for once, after a 401.
 * A `DriveAuthError` thrown by `getToken` is not caught here: the caller tells the person what to do.
 * `sleep` waits between the repeats of a rate-limited request.
 */
export function createDrive(
  getToken: (forceRefresh?: boolean) => Promise<string>,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
  sleep: (ms: number) => Promise<void> = wait,
): Drive {
  let folderId: Promise<string> | null = null

  async function attempt(url: string, init: RequestInit, token: string): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    // The timer runs until the answer starts: a body being read is never cut.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutFor(init))
    try {
      return await fetchFn(url, { ...init, headers, signal: controller.signal })
    } catch {
      throw new DriveError('offline', 'No connection to Google Drive')
    } finally {
      clearTimeout(timer)
    }
  }

  /** One authorized try: a 401 gets a fresh token and one more. */
  async function authorized(url: string, init: RequestInit): Promise<Response> {
    const response = await attempt(url, init, await getToken())
    if (response.status !== 401) return response
    const again = await attempt(url, init, await getToken(true))
    if (again.status === 401)
      throw new DriveError('revoked', 'Google Drive refused the access', 401)
    return again
  }

  /** The DriveError for a failed answer, and whether it only asks to slow down. */
  async function failure(response: Response): Promise<{ error: DriveError; rateLimited: boolean }> {
    const { status } = response
    const reasons = status === 403 || status === 429 ? await errorReasons(response) : []
    const reason = reasons[0]
    if (reasons.includes('storageQuotaExceeded')) {
      const error = new DriveError('full', 'Google Drive is full', status, reason)
      return { error, rateLimited: false }
    }
    if (status === 403 && reasons.some((r) => SCOPE_REASONS.has(r))) {
      const error = new DriveError('revoked', 'Google Drive access was not granted', status, reason)
      return { error, rateLimited: false }
    }
    const rateLimited =
      status === 429 || (status === 403 && reasons.some((r) => RATE_LIMIT_REASONS.has(r)))
    const error = new DriveError('other', `Google Drive request failed (${status})`, status, reason)
    return { error, rateLimited }
  }

  /**
   * One authorized request; failures become DriveErrors. A rate limit (a 429, or a 403 that says
   * so) is repeated after 1 s, 2 s and 4 s before it fails.
   */
  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    for (let repeat = 0; ; repeat++) {
      const response = await authorized(url, init)
      if (response.ok) return response
      const { error, rateLimited } = await failure(response)
      const delay = RATE_LIMIT_DELAYS_MS[repeat]
      if (!rateLimited || delay === undefined) throw error
      await sleep(delay)
    }
  }

  async function readJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T
    } catch {
      throw new DriveError('other', 'Google Drive sent an unreadable answer')
    }
  }

  const jsonInit = (method: string, payload: unknown, extra: HeadersInit = {}): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', ...extra },
    body: JSON.stringify(payload),
  })

  /** Resumable upload: the metadata opens a session, then the bytes go to the session's Location. */
  async function upload(
    url: string,
    method: 'POST' | 'PATCH',
    metadata: object,
    body: Blob,
  ): Promise<RemoteFile> {
    const extra: Record<string, string> = body.type ? { 'X-Upload-Content-Type': body.type } : {}
    const session = await request(url, jsonInit(method, metadata, extra))
    const location = session.headers.get('Location')
    if (!location) throw new DriveError('other', 'Google Drive gave no upload address')
    const done = await request(location, {
      method: 'PUT',
      headers: { 'Content-Type': body.type || 'application/octet-stream' },
      body,
    })
    return toRemoteFile(await readJson<RawFile>(done))
  }

  async function findOrCreateFolder(): Promise<string> {
    const q = `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and 'root' in parents and trashed=false`
    const found = await request(
      `${API}/drive/v3/files?${new URLSearchParams({ q, fields: 'files(id)' })}`,
    )
    const { files = [] } = await readJson<{ files?: RawFile[] }>(found)
    if (files[0]) return files[0].id
    const created = await request(
      `${API}/drive/v3/files?fields=id`,
      jsonInit('POST', { name: FOLDER_NAME, mimeType: FOLDER_MIME, parents: ['root'] }),
    )
    return (await readJson<RawFile>(created)).id
  }

  return {
    ensureFolder() {
      // The in-flight promise is shared so concurrent first calls never create two folders.
      folderId ??= findOrCreateFolder().catch((e: unknown) => {
        folderId = null
        throw e
      })
      return folderId
    },

    async list(folder) {
      const out: RemoteFile[] = []
      let pageToken: string | undefined
      do {
        const params = new URLSearchParams({
          q: `'${folder}' in parents and trashed=false`,
          fields: 'nextPageToken,files(id,name,version,appProperties,md5Checksum)',
          pageSize: '1000',
        })
        if (pageToken) params.set('pageToken', pageToken)
        const page = await readJson<{ nextPageToken?: string; files?: RawFile[] }>(
          await request(`${API}/drive/v3/files?${params}`),
        )
        out.push(...(page.files ?? []).map(toRemoteFile))
        pageToken = page.nextPageToken
      } while (pageToken)
      return out
    },

    async download(fileId) {
      const response = await request(
        `${API}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      )
      return response.blob()
    },

    create(folder, name, body, appProperties) {
      const metadata: Record<string, unknown> = { name, parents: [folder], appProperties }
      if (body.type) metadata.mimeType = body.type
      return upload(
        `${API}/upload/drive/v3/files?uploadType=resumable&fields=${FILE_FIELDS}`,
        'POST',
        metadata,
        body,
      )
    },

    update(fileId, body) {
      return upload(
        `${API}/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=${FILE_FIELDS}`,
        'PATCH',
        {},
        body,
      )
    },

    async trash(fileId) {
      await request(
        `${API}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id`,
        jsonInit('PATCH', { trashed: true }),
      )
    },
  }
}
