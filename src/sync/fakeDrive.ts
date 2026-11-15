import { DriveError, type Drive, type RemoteFile } from './drive'
import { md5 } from './md5'
import { APP_PROPERTY_BYTES } from './remote'

export interface FakeFile {
  id: string
  name: string
  version: string
  appProperties: Record<string, string>
  parents: string[]
  trashed: boolean
  body: Blob
}

export type FakeDrive = Drive & { files: Map<string, FakeFile> }

export interface FakeDriveOptions {
  /**
   * Like the real Drive, a file's version moves on again after its upload has answered (Google
   * bumps `version` for changes it makes on its own side), so the version an upload returned is
   * already stale when the folder is next listed.
   */
  bumpVersionAfterWrite?: boolean
}

/** In-memory Drive for unit tests: versions go up by one with every write of a file. */
export function createFakeDrive({
  bumpVersionAfterWrite = false,
}: FakeDriveOptions = {}): FakeDrive {
  const files = new Map<string, FakeFile>()
  let nextId = 1
  let folder: string | null = null

  const view = (f: FakeFile): RemoteFile => ({
    id: f.id,
    name: f.name,
    version: f.version,
    appProperties: { ...f.appProperties },
  })

  /** The answer to an upload; with bumpVersionAfterWrite the stored version then moves on. */
  const written = (f: FakeFile): RemoteFile => {
    const answer = view(f)
    if (bumpVersionAfterWrite) f.version = String(Number(f.version) + 1)
    return answer
  }

  const get = (fileId: string): FakeFile => {
    const file = files.get(fileId)
    if (!file) throw new DriveError('other', 'Google Drive request failed (404)', 404)
    return file
  }

  return {
    files,
    async ensureFolder() {
      folder ??= `folder-${nextId++}`
      return folder
    },
    async list(folderId) {
      // Like Google, the listing gives each file's md5Checksum.
      const live = [...files.values()].filter((f) => !f.trashed && f.parents.includes(folderId))
      return Promise.all(
        live.map(async (f) => ({
          ...view(f),
          md5Checksum: md5(new Uint8Array(await f.body.arrayBuffer())),
        })),
      )
    },
    async download(fileId) {
      return get(fileId).body
    },
    async create(folderId, name, body, appProperties) {
      // Like Google: key + value of each appProperty is capped in UTF-8 bytes.
      for (const [key, value] of Object.entries(appProperties)) {
        if (new TextEncoder().encode(key + value).length > APP_PROPERTY_BYTES) {
          throw new DriveError('other', 'Google Drive request failed (400)', 400, 'badRequest')
        }
      }
      const file: FakeFile = {
        id: `file-${nextId++}`,
        name,
        version: '1',
        appProperties: { ...appProperties },
        parents: [folderId],
        trashed: false,
        body,
      }
      files.set(file.id, file)
      return written(file)
    },
    async update(fileId, body) {
      const file = get(fileId)
      file.body = body
      file.version = String(Number(file.version) + 1)
      return written(file)
    },
    async trash(fileId) {
      const file = get(fileId)
      file.trashed = true
      file.version = String(Number(file.version) + 1)
    },
  }
}
