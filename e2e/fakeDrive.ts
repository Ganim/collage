import { createHash } from 'node:crypto'
import type { BrowserContext, Route } from '@playwright/test'

export interface FakeDriveFile {
  id: string
  name: string
  version: string
  appProperties: Record<string, string>
  parents: string[]
  trashed: boolean
  body: Buffer
  mimeType: string
}

export interface FakeDriveState {
  files: Map<string, FakeDriveFile>
  nextId: number
}

export function createFakeDriveState(): FakeDriveState {
  return { files: new Map(), nextId: 1 }
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const UPLOAD_PATH = '/__fake_upload/'

/** "*" does not cover Authorization in preflights, so the requested headers are reflected. */
function cors(route: Route): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers':
      route.request().headers()['access-control-request-headers'] ??
      'authorization,content-type,x-upload-content-type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,OPTIONS',
    'access-control-expose-headers': 'Location',
  }
}

interface Metadata {
  name?: string
  parents?: string[]
  appProperties?: Record<string, string>
  mimeType?: string
}

interface PendingUpload {
  /** Existing file id for an update, absent for a create. */
  fileId?: string
  metadata: Metadata
}

const pending = new WeakMap<FakeDriveState, Map<string, PendingUpload>>()

/** Like Google, a file's md5Checksum is that of its bytes; a folder has none. */
function view(f: FakeDriveFile) {
  return {
    id: f.id,
    name: f.name,
    version: f.version,
    appProperties: f.appProperties,
    ...(f.mimeType === FOLDER_MIME
      ? {}
      : { md5Checksum: createHash('md5').update(f.body).digest('hex') }),
  }
}

function reply(route: Route, status: number, json?: unknown, headers: Record<string, string> = {}) {
  return route.fulfill({
    status,
    headers: { ...cors(route), ...headers },
    ...(json === undefined ? {} : { json }),
  })
}

/** Google caps key + value of each appProperty at 124 UTF-8 bytes and refuses the request. */
const tooLongProperty = (metadata: Metadata) =>
  Object.entries(metadata.appProperties ?? {}).some(
    ([key, value]) => Buffer.byteLength(key + value, 'utf8') > 124,
  )

const badRequest = (route: Route) =>
  reply(route, 400, { error: { code: 400, errors: [{ reason: 'badRequest' }] } })

const notFound = (route: Route) =>
  reply(route, 404, { error: { errors: [{ reason: 'notFound' }] } })

/**
 * Plays Google Drive (and the service's drive-token endpoint) for a browser context. Two contexts
 * given the same `state` behave as two devices on one Drive.
 */
export async function routeFakeDrive(
  context: BrowserContext,
  state: FakeDriveState,
): Promise<void> {
  const uploads = pending.get(state) ?? new Map<string, PendingUpload>()
  pending.set(state, uploads)

  const newFile = (metadata: Metadata, body: Buffer): FakeDriveFile => {
    const file: FakeDriveFile = {
      id: `fake-${state.nextId++}`,
      name: metadata.name ?? '',
      version: '1',
      appProperties: metadata.appProperties ?? {},
      parents: metadata.parents ?? [],
      trashed: false,
      body,
      mimeType: metadata.mimeType ?? 'application/octet-stream',
    }
    state.files.set(file.id, file)
    return file
  }

  // Playwright's WebKit hands a route no body for a request whose body is a Blob, and uploads
  // send Blobs. Only for the fake Drive, the page sends those bytes as an ArrayBuffer instead.
  await context.addInitScript(() => {
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith('https://www.googleapis.com/') && init?.body instanceof Blob) {
        init = { ...init, body: await init.body.arrayBuffer() }
      }
      return original(input, init)
    }
  })

  await context.route('**/api/auth/drive-token', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake', expiresIn: 3600 } }),
  )

  await context.route('https://www.googleapis.com/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const path = url.pathname

    if (method === 'OPTIONS') return reply(route, 204)

    // Resumable session: the bytes arrive here.
    if (path.startsWith(UPLOAD_PATH) && method === 'PUT') {
      const sessionId = path.slice(UPLOAD_PATH.length)
      const session = uploads.get(sessionId)
      if (!session) return notFound(route)
      uploads.delete(sessionId)
      const body = request.postDataBuffer() ?? Buffer.alloc(0)
      if (session.fileId) {
        const existing = state.files.get(session.fileId)
        if (!existing) return notFound(route)
        existing.body = body
        existing.version = String(Number(existing.version) + 1)
        return reply(route, 200, view(existing))
      }
      return reply(route, 200, view(newFile(session.metadata, body)))
    }

    // Open a resumable session (create or update).
    if (
      path.startsWith('/upload/drive/v3/files') &&
      url.searchParams.get('uploadType') === 'resumable'
    ) {
      const fileId = path.split('/')[5]
      if (fileId && !state.files.has(fileId)) return notFound(route)
      const metadata = (request.postDataJSON() ?? {}) as Metadata
      if (tooLongProperty(metadata)) return badRequest(route)
      const sentType = await request.headerValue('x-upload-content-type')
      const sessionId = String(state.nextId++)
      uploads.set(sessionId, {
        fileId,
        metadata: { ...metadata, mimeType: metadata.mimeType ?? sentType ?? undefined },
      })
      return reply(route, 200, undefined, {
        location: `${url.origin}${UPLOAD_PATH}${sessionId}`,
      })
    }

    if (path === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      const parent = /'([^']+)' in parents/.exec(q)?.[1]
      const name = /name='([^']+)'/.exec(q)?.[1]
      const wantsFolder = q.includes(FOLDER_MIME)
      const wantsLive = q.includes('trashed=false')
      const files = [...state.files.values()].filter(
        (f) =>
          (!parent || f.parents.includes(parent)) &&
          (!name || f.name === name) &&
          (!wantsFolder || f.mimeType === FOLDER_MIME) &&
          (!wantsLive || !f.trashed),
      )
      return reply(route, 200, { files: files.map(view) })
    }

    if (path === '/drive/v3/files' && method === 'POST') {
      const metadata = (request.postDataJSON() ?? {}) as Metadata
      if (tooLongProperty(metadata)) return badRequest(route)
      return reply(route, 200, view(newFile(metadata, Buffer.alloc(0))))
    }

    const single = /^\/drive\/v3\/files\/([^/]+)$/.exec(path)
    if (single) {
      const file = state.files.get(decodeURIComponent(single[1]!))
      if (!file) return notFound(route)
      if (method === 'GET' && url.searchParams.get('alt') === 'media') {
        return route.fulfill({
          status: 200,
          headers: { ...cors(route), 'content-type': file.mimeType },
          body: file.body,
        })
      }
      if (method === 'PATCH') {
        const patch = (request.postDataJSON() ?? {}) as { trashed?: boolean }
        if (typeof patch.trashed === 'boolean') file.trashed = patch.trashed
        file.version = String(Number(file.version) + 1)
        return reply(route, 200, view(file))
      }
      if (method === 'GET') return reply(route, 200, view(file))
    }

    return notFound(route)
  })
}
