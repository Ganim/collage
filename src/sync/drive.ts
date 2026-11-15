/** Thin fetch client of the Drive REST v3 API, limited to the files this app created (drive.file). */

export interface RemoteFile {
  id: string
  name: string
  /** Drive's version counter: a string of digits that grows with every change. */
  version: string
  appProperties: Record<string, string>
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
}

function toRemoteFile(raw: RawFile): RemoteFile {
  return {
    id: raw.id,
    name: raw.name ?? '',
    version: String(raw.version ?? ''),
    appProperties: raw.appProperties ?? {},
  }
}

async function isQuotaError(response: Response): Promise<boolean> {
  if (response.status !== 403 && response.status !== 429) return false
  try {
    const body = (await response.clone().json()) as {
      error?: { errors?: { reason?: unknown }[] }
    }
    return body.error?.errors?.some((e) => e.reason === 'storageQuotaExceeded') === true
  } catch {
    return false
  }
}

/**
 * `getToken(true)` must return a token that skips any cache; it is asked for once, after a 401.
 * A `DriveAuthError` thrown by `getToken` is not caught here: the caller tells the person what to do.
 */
export function createDrive(
  getToken: (forceRefresh?: boolean) => Promise<string>,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Drive {
  let folderId: Promise<string> | null = null

  async function attempt(url: string, init: RequestInit, token: string): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    try {
      return await fetchFn(url, { ...init, headers })
    } catch {
      throw new DriveError('offline', 'No connection to Google Drive')
    }
  }

  /** One authorized request: a 401 gets a fresh token and one more try; failures become DriveErrors. */
  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    let response = await attempt(url, init, await getToken())
    if (response.status === 401) {
      response = await attempt(url, init, await getToken(true))
      if (response.status === 401) {
        throw new DriveError('revoked', 'Google Drive refused the access')
      }
    }
    if (response.ok) return response
    if (await isQuotaError(response)) throw new DriveError('full', 'Google Drive is full')
    throw new DriveError('other', `Google Drive request failed (${response.status})`)
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
          fields: 'nextPageToken,files(id,name,version,appProperties)',
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
