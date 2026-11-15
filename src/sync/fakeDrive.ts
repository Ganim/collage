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
  /** The sharing permissions given to the file. */
  permissions: { role: string; type: string }[]
}

export type FakeDrive = Drive & {
  files: Map<string, FakeFile>
  /** The subfolders of the Collage folder, by name. */
  subfolders: Map<string, string>
}

/**
 * In-memory Drive for unit tests: versions go up by one with every write of a file, and `list`
 * gives each file's md5Checksum like Google.
 */
export function createFakeDrive(): FakeDrive {
  const files = new Map<string, FakeFile>()
  let nextId = 1
  let folder: string | null = null
  const subfolders = new Map<string, string>()

  const view = (f: FakeFile): RemoteFile => ({
    id: f.id,
    name: f.name,
    version: f.version,
    appProperties: { ...f.appProperties },
  })

  const get = (fileId: string): FakeFile => {
    const file = files.get(fileId)
    if (!file) throw new DriveError('other', 'Google Drive request failed (404)', 404)
    return file
  }

  return {
    files,
    subfolders,
    async ensureFolder() {
      folder ??= `folder-${nextId++}`
      return folder
    },
    async ensureSubfolder(name) {
      let id = subfolders.get(name)
      if (!id) {
        id = `folder-${nextId++}`
        subfolders.set(name, id)
      }
      return id
    },
    async list(folderId) {
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
        permissions: [],
      }
      files.set(file.id, file)
      return view(file)
    },
    async update(fileId, body) {
      const file = get(fileId)
      file.body = body
      file.version = String(Number(file.version) + 1)
      return view(file)
    },
    async trash(fileId) {
      const file = get(fileId)
      file.trashed = true
      file.version = String(Number(file.version) + 1)
    },
    async share(fileId) {
      get(fileId).permissions.push({ role: 'reader', type: 'anyone' })
      return `https://drive.google.com/file/d/${fileId}/view`
    },
  }
}
