import type { SavedSize, SizeFolder } from '../core/types'

export interface LibraryFile {
  sizes: SavedSize[]
  folders: SizeFolder[]
  deleted: {
    size: Record<string, number>
    folder: Record<string, number>
    collection: Record<string, number>
  }
}

type Stamped = { id: string; updatedAt?: number }
type Times = Record<string, number>

function mergeTimes(a: Times, b: Times): Times {
  const out: Times = { ...a }
  for (const [id, at] of Object.entries(b)) out[id] = Math.max(out[id] ?? at, at)
  return out
}

/** Union by id (newest updatedAt wins), then apply tombstones; returns survivors and kept tombstones. */
function mergeItems<T extends Stamped>(
  a: T[],
  b: T[],
  deleted: Times,
): { items: T[]; deleted: Times } {
  const byId = new Map<string, T>()
  for (const item of [...a, ...b]) {
    const cur = byId.get(item.id)
    if (!cur || (item.updatedAt ?? 0) > (cur.updatedAt ?? 0)) byId.set(item.id, item)
  }
  const items: T[] = []
  const kept: Times = {}
  for (const [id, at] of Object.entries(deleted)) {
    const item = byId.get(id)
    if (!item || (item.updatedAt ?? 0) < at) kept[id] = at
  }
  for (const item of byId.values()) {
    const at = deleted[item.id]
    if (at === undefined || (item.updatedAt ?? 0) >= at) items.push(item)
  }
  items.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  return { items, deleted: kept }
}

/** Merges the local library with the remote one. Pure: same inputs, same output. */
export function mergeLibrary(local: LibraryFile, remote: LibraryFile | null): LibraryFile {
  const r: LibraryFile = remote ?? {
    sizes: [],
    folders: [],
    deleted: { size: {}, folder: {}, collection: {} },
  }
  const sizes = mergeItems(local.sizes, r.sizes, mergeTimes(local.deleted.size, r.deleted.size))
  const folders = mergeItems(
    local.folders,
    r.folders,
    mergeTimes(local.deleted.folder, r.deleted.folder),
  )
  return {
    sizes: sizes.items.map((s) => {
      if (s.folderId === undefined || !(s.folderId in folders.deleted)) return s
      const rest = { ...s }
      delete rest.folderId
      return rest
    }),
    folders: folders.items,
    deleted: {
      size: sizes.deleted,
      folder: folders.deleted,
      // Collections are not stored in the library file, so their tombstones are only unioned.
      collection: mergeTimes(local.deleted.collection, r.deleted.collection),
    },
  }
}

/**
 * Drops a collection's deletion record from the library. The engine calls this together with
 * removing the local tombstone whenever the plan says `forgetTombstone`.
 */
export function forgetCollectionDeletion(lib: LibraryFile, id: string): LibraryFile {
  const collection = { ...lib.deleted.collection }
  delete collection[id]
  return { ...lib, deleted: { ...lib.deleted, collection } }
}
