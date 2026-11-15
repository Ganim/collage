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

/** The account the app is signed in with. */
export interface Owner {
  id: string
  email: string
}

/** Per-collection sync bookkeeping. A collection without one is unowned and was never synced. */
export interface SyncState {
  ownerId?: string
  ownerEmail?: string
  remoteFileId?: string
  remoteVersion?: string
  /** Changed locally since the last upload. */
  dirty: boolean
}

/** A local deletion the sync has yet to carry to the Drive. */
export interface Tombstone {
  kind: 'collection' | 'size' | 'folder'
  id: string
  at: number
  remoteFileId?: string
}

/** What PDF generation needs: photos only. */
export type PhotoReader = Pick<Store, 'getPhoto' | 'getPhotosMeta'>

export interface Store {
  putPhoto(p: StoredPhoto): Promise<void>
  getPhoto(id: string): Promise<StoredPhoto | undefined>
  getPhotosMeta(ids: string[]): Promise<Record<string, Photo>>
  /** Also marks it dirty; an unowned collection goes to the current owner. */
  saveCollection(c: Collection): Promise<void>
  /**
   * Atomically writes the collection and its photos; never overwrites a photo that already exists.
   * Marks the collection dirty like saveCollection.
   */
  importCollection(photos: StoredPhoto[], collection: Collection): Promise<void>
  /** Any collection, whoever owns it. */
  getCollection(id: string): Promise<Collection | undefined>
  /** The current owner's collections and unowned ones; all of them when there is no owner. */
  listCollections(): Promise<CollectionSummary[]>
  /**
   * Also deletes photos that no other collection uses and the collection's sync state. Leaves a
   * tombstone when the collection was ever uploaded.
   */
  deleteCollection(id: string): Promise<void>
  /** Frees a photo's files, unless a saved collection still lists it. */
  deletePhotoIfUnused(id: string): Promise<void>
  listSizes(): Promise<SavedSize[]>
  /** Stamps updatedAt and marks the library dirty. */
  saveSize(s: SavedSize): Promise<void>
  /** Marks the library dirty and leaves a tombstone. */
  deleteSize(id: string): Promise<void>
  listFolders(): Promise<SizeFolder[]>
  /** Stamps updatedAt and marks the library dirty. */
  saveFolder(f: SizeFolder): Promise<void>
  /**
   * Deletes the folder and moves its sizes out of it (they lose their folderId and get a new
   * updatedAt). Marks the library dirty and leaves a tombstone.
   */
  deleteFolder(id: string): Promise<void>
  /**
   * Writes `copy` (photos are shared by id), marked dirty like saveCollection; rejects with
   * Error('missing') if `id` does not exist.
   */
  duplicateCollection(id: string, copy: Collection): Promise<void>
  /** Undefined when the last collection belongs to an owner other than the current one. */
  getLastCollectionId(): Promise<string | undefined>
  setLastCollectionId(id: string): Promise<void>

  /** The account in use; null when signed out. */
  setOwner(owner: Owner | null): Promise<void>
  getSyncStates(): Promise<Record<string, SyncState>>
  /** Merges `patch` into the collection's state (a missing state starts as not dirty). */
  setSyncState(id: string, patch: Partial<SyncState>): Promise<void>
  listTombstones(): Promise<Tombstone[]>
  clearTombstones(keys: { kind: Tombstone['kind']; id: string }[]): Promise<void>
  /** Writes a collection that came from the Drive, with `state` as is: not marked dirty. */
  putRemoteCollection(c: Collection, state: SyncState): Promise<void>
  /** Deletes the collection and its sync state without a tombstone, freeing unused photos. */
  removeLocalCollection(id: string): Promise<void>
  isLibraryDirty(): Promise<boolean>
  setLibraryDirty(v: boolean): Promise<void>
  /** Replaces every size and folder with the Drive's, without marking the library dirty. */
  putRemoteLibrary(sizes: SavedSize[], folders: SizeFolder[]): Promise<void>
  /** Owners of local collections other than the current one, with how many each has. */
  listOtherOwners(): Promise<{ id: string; email: string; count: number }[]>
  /**
   * Hands that owner's collections to the current owner, dirty and with no remote file, so they
   * upload as new files to the current account. Rejects when there is no current owner.
   */
  claimCollections(fromOwnerId: string): Promise<void>
}

export class StorageFullError extends Error {
  constructor(message = 'Device storage is full') {
    super(message)
    this.name = 'StorageFullError'
  }
}
