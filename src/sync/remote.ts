import type { Collection } from '../core/types'
import { StorageFullError, type Tombstone } from '../storage/store'
import { DriveAuthError, DriveNetworkError } from '../ui/account/account'
import { DriveError, type RemoteFile } from './drive'
import type { LibraryFile } from './library'
import type { SyncStatus } from './status'

/** Pure helpers of the sync engine: reading what is on the Drive and naming failures. */

/** The app's folder on the Drive, its files indexed by what they hold. */
export interface Listing {
  folder: string
  library?: RemoteFile
  /** Every file per collection id; normally one. */
  collections: Map<string, RemoteFile[]>
  photos: Map<string, RemoteFile>
}

/** Google Drive refuses an appProperty whose key and value together pass this many UTF-8 bytes. */
export const APP_PROPERTY_BYTES = 124

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length

/**
 * The properties with every value cut, on a code-point boundary, so that key + value fits the
 * Drive's limit; a longer value would make the Drive refuse the whole file.
 */
export function fitAppProperties(props: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => {
      let room = APP_PROPERTY_BYTES - utf8Bytes(key)
      let out = ''
      for (const ch of value) {
        room -= utf8Bytes(ch)
        if (room < 0) break
        out += ch
      }
      return [key, out]
    }),
  )
}

/** JSON with object keys sorted, to compare content regardless of key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  )
}

export function isCollection(value: unknown, id: string): value is Collection {
  const c = value as Partial<Collection> | null
  return (
    typeof c === 'object' &&
    c !== null &&
    c.schemaVersion === 1 &&
    c.id === id &&
    Array.isArray(c.photoIds) &&
    Array.isArray(c.frames)
  )
}

const record = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {}

/** A library.json as read from the Drive; null when it is not one. */
export function toLibrary(value: unknown): LibraryFile | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<LibraryFile>
  const deleted = (v.deleted ?? {}) as Partial<LibraryFile['deleted']>
  return {
    sizes: Array.isArray(v.sizes) ? v.sizes : [],
    folders: Array.isArray(v.folders) ? v.folders : [],
    deleted: {
      size: record(deleted.size),
      folder: record(deleted.folder),
      collection: record(deleted.collection),
    },
  }
}

export const isEmptyLibrary = (lib: LibraryFile) =>
  lib.sizes.length === 0 &&
  lib.folders.length === 0 &&
  Object.keys(lib.deleted.size).length === 0 &&
  Object.keys(lib.deleted.folder).length === 0 &&
  Object.keys(lib.deleted.collection).length === 0

export function deletionTimes(tombstones: Tombstone[]): Record<string, number> {
  return Object.fromEntries(tombstones.map((t) => [t.id, t.at]))
}

export function indexListing(folder: string, files: RemoteFile[]): Listing {
  const listing: Listing = { folder, collections: new Map(), photos: new Map() }
  for (const f of files) {
    const props = f.appProperties
    if (props.kind === 'library') listing.library ??= f
    else if (props.kind === 'photo' && props.photoId) listing.photos.set(props.photoId, f)
    else if (props.kind === 'collection' && props.collectionId) {
      const list = listing.collections.get(props.collectionId) ?? []
      list.push(f)
      listing.collections.set(props.collectionId, list)
    }
  }
  return listing
}

/**
 * Failures that only mean "no connection": the Drive client's offline error (fetch rejected or
 * timed out), the token service unreachable, and a request aborted by its timer. A bare
 * TypeError is not one: real fetch rejections are already wrapped, so it is a bug.
 */
function isNetworkFailure(e: unknown): boolean {
  if (e instanceof DriveError) return e.kind === 'offline'
  if (e instanceof DriveNetworkError) return true
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
}

/**
 * What the status shows after a failed pass. An unexpected failure is logged with a fixed text
 * and the error's name only: its message could carry a token or a URL.
 */
export function failureStatus(e: unknown): Partial<SyncStatus> {
  if (isNetworkFailure(e)) return { state: 'offline', error: undefined }
  if (e instanceof DriveAuthError) {
    if (e.reason === 'no_drive') return { state: 'needsDrive', error: undefined }
    if (e.reason === 'revoked') return { state: 'error', error: 'revoked' }
    return { state: 'off', error: undefined }
  }
  if (e instanceof DriveError && (e.kind === 'full' || e.kind === 'revoked')) {
    return { state: 'error', error: e.kind }
  }
  if (!(e instanceof StorageFullError)) {
    console.error('Sync failed:', e instanceof Error ? e.name : typeof e)
  }
  return { state: 'error', error: 'other' }
}
