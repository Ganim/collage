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
  /** The MD5 of the JSON this device last uploaded for the collection. */
  remoteMd5?: string
  /** Changed locally since the last upload. */
  dirty: boolean
}

export type SaveOutcome = 'saved' | { conflictCopyId: string }

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
  /**
   * Also marks it dirty; an unowned collection goes to the current owner.
   *
   * With `baseUpdatedAt` (the updatedAt of the stored version the edit started from): when the
   * stored collection's updatedAt differs, something else (a pull) wrote it meanwhile. That
   * version is then kept as a new collection named with the conflict suffix, and `c` is saved
   * over the original, dirty and with its current remote version, in one transaction. Resolves
   * to the copy's id then, else to 'saved'. This device's own uploads never change updatedAt.
   */
  saveCollection(c: Collection, options?: { baseUpdatedAt?: number }): Promise<SaveOutcome>
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
  getOwner(): Promise<Owner | null>
  getSyncStates(): Promise<Record<string, SyncState>>
  /** Merges `patch` into the collection's state (a missing state starts as not dirty). */
  setSyncState(id: string, patch: Partial<SyncState>): Promise<void>
  listTombstones(): Promise<Tombstone[]>
  clearTombstones(keys: { kind: Tombstone['kind']; id: string }[]): Promise<void>
  /**
   * Writes a collection that came from the Drive, with `state` as is: not marked dirty. Skips it
   * when the local one is dirty, so an edit is never overwritten; resolves to whether it wrote.
   */
  putRemoteCollection(c: Collection, state: SyncState): Promise<boolean>
  /**
   * Saves the Drive's version of a conflicting collection as `copy` (dirty, like saveCollection)
   * and, in the same transaction, records on the original that this remote version was seen, so
   * a retried pass uploads the original instead of copying again. The original stays dirty.
   */
  saveConflictCopy(
    copy: Collection,
    originalId: string,
    remoteFileId: string,
    remoteVersion: string,
  ): Promise<void>
  /**
   * After an upload: records the Drive file and clears dirty, unless the collection changed since
   * the uploaded copy (its updatedAt differs), in which case it stays dirty. A collection deleted
   * meanwhile is left alone. `md5` is that of the bytes uploaded; without it none is kept.
   */
  markPushed(
    id: string,
    uploadedUpdatedAt: number,
    fileId: string,
    version: string,
    md5?: string,
  ): Promise<void>
  /**
   * Deletes the collection and its sync state without a tombstone, freeing unused photos. With
   * `onlyIfClean`, a collection that is dirty at that moment is kept. Resolves to whether it
   * removed the collection.
   */
  removeLocalCollection(id: string, options?: { onlyIfClean?: boolean }): Promise<boolean>
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
  /** A small app preference kept on the device. The store's own keys are refused. */
  getMeta(key: string): Promise<string | boolean | undefined>
  setMeta(key: string, value: string | boolean): Promise<void>
}

export class StorageFullError extends Error {
  constructor(message = 'Device storage is full') {
    super(message)
    this.name = 'StorageFullError'
  }
}
