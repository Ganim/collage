import type { Collection, Photo, SavedSize } from '../core/types'

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
  getLastCollectionId(): Promise<string | undefined>
  setLastCollectionId(id: string): Promise<void>
}

export class StorageFullError extends Error {
  constructor(message = 'Device storage is full') {
    super(message)
    this.name = 'StorageFullError'
  }
}
