import { DriveError, type Drive, type RemoteFile } from './drive'

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

/** In-memory Drive for unit tests: versions go up by one with every write of a file. */
export function createFakeDrive(): FakeDrive {
  const files = new Map<string, FakeFile>()
  let nextId = 1
  let folder: string | null = null

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
    async ensureFolder() {
      folder ??= `folder-${nextId++}`
      return folder
    },
    async list(folderId) {
      return [...files.values()].filter((f) => !f.trashed && f.parents.includes(folderId)).map(view)
    },
    async download(fileId) {
      return get(fileId).body
    },
    async create(folderId, name, body, appProperties) {
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
  }
}
