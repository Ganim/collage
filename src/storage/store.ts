import type { Collection, Photo, SavedSize, SizeFolder } from '../core/types'

export interface StoredPhoto extends Photo {
  original: Blob
  preview: Blob
  thumb: Blob
}

export interface CollectionSummary {
  id: string
  name: string
  updatedAt: number
  frameCount: number
  /** First background layer of the first frame that has layers, else the first photo, else null. */
  coverPhotoId: string | null
  photoCount: number
}

export interface Store {
  putPhoto(p: StoredPhoto): Promise<void>
  getPhoto(id: string): Promise<StoredPhoto | undefined>
  getPhotosMeta(ids: string[]): Promise<Record<string, Photo>>
  saveCollection(c: Collection): Promise<void>
  /** Atomically writes the collection and its photos; never overwrites a photo that already exists. */
  importCollection(photos: StoredPhoto[], collection: Collection): Promise<void>
  getCollection(id: string): Promise<Collection | undefined>
  listCollections(): Promise<CollectionSummary[]>
  /** Also deletes photos that no other collection uses. */
  deleteCollection(id: string): Promise<void>
  /** Frees a photo's files, unless a saved collection still lists it. */
  deletePhotoIfUnused(id: string): Promise<void>
  listSizes(): Promise<SavedSize[]>
  saveSize(s: SavedSize): Promise<void>
  deleteSize(id: string): Promise<void>
  listFolders(): Promise<SizeFolder[]>
  saveFolder(f: SizeFolder): Promise<void>
  /** Deletes the folder and moves its sizes out of it (they lose their folderId). */
  deleteFolder(id: string): Promise<void>
  /** Writes `copy` (photos are shared by id); rejects with Error('missing') if `id` does not exist. */
  duplicateCollection(id: string, copy: Collection): Promise<void>
  getLastCollectionId(): Promise<string | undefined>
  setLastCollectionId(id: string): Promise<void>
}

export class StorageFullError extends Error {
  constructor(message = 'Device storage is full') {
    super(message)
    this.name = 'StorageFullError'
  }
}
