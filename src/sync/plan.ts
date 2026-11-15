import type { SyncState, Tombstone } from '../storage/store'

/**
 * `forgetTombstone(id)` means: drop id from library.json `deleted.collection` AND from the local
 * tombstones, if present in either (see forgetCollectionDeletion in library.ts).
 *
 * `detachRemote(id, fileId)`: the collection is local-only and its file is on the Drive: trash
 * the file, record id in library.json `detached.collection` and forget the local remoteFileId.
 * `markLocalOnly(id)`: another device removed the collection from the Drive: mark the local copy
 * local-only; it is kept, never deleted. `forgetDetached(id)`: drop id from library.json
 * `detached.collection` (see forgetCollectionDetachment in library.ts).
 */
export type Action =
  | { kind: 'push'; id: string }
  | { kind: 'pull'; id: string; fileId: string; version: string }
  | { kind: 'conflict'; id: string; fileId: string; version: string }
  | { kind: 'deleteLocal'; id: string }
  | { kind: 'trashRemote'; id: string; fileId: string }
  | { kind: 'forgetTombstone'; id: string }
  | { kind: 'detachRemote'; id: string; fileId: string }
  | { kind: 'markLocalOnly'; id: string }
  | { kind: 'forgetDetached'; id: string }

export interface PlanInput {
  /** Every local collection of the current account. A missing remoteFileId means never uploaded. */
  local: Record<string, SyncState>
  /** `md5` is the Drive's md5Checksum of the file, when it gave one. */
  remote: Record<string, { fileId: string; version: string; md5?: string }>
  /** Collection deletions recorded in library.json. */
  remoteDeleted: Record<string, number>
  /** Local tombstones of kind 'collection'. */
  localTombstones: Tombstone[]
  /** Collections removed from the Drive, from library.json `detached.collection`. */
  remoteDetached?: Record<string, number>
}

/** Decides what to do with each collection. Pure and deterministic: actions are ordered by id. */
export function planCollections(input: PlanInput): Action[] {
  const { local, remote, remoteDeleted, localTombstones, remoteDetached = {} } = input
  const tombstones = new Map<string, Tombstone>()
  for (const t of localTombstones) if (t.kind === 'collection') tombstones.set(t.id, t)

  const ids = new Set<string>([...Object.keys(local), ...Object.keys(remote), ...tombstones.keys()])
  const actions: Action[] = []

  for (const id of [...ids].sort()) {
    const state = local[id] as SyncState | undefined
    const file = remote[id] as RemoteEntry | undefined
    const tomb = tombstones.get(id)

    // 1. Local deletion: trash the remote file, or just drop the record if it is already gone.
    if (tomb) {
      if (file && tomb.remoteFileId && tomb.remoteFileId === file.fileId) {
        actions.push({ kind: 'trashRemote', id, fileId: file.fileId })
      } else {
        actions.push({ kind: 'forgetTombstone', id })
      }
      continue
    }

    // 2. Local-only: out of the sync, never pushed, pulled nor deleted. Its file, if still on the
    // Drive, goes to the trash.
    if (state?.localOnly) {
      if (file && state.remoteFileId !== undefined) {
        actions.push({ kind: 'detachRemote', id, fileId: file.fileId })
      }
      continue
    }

    // 3. Removed from the Drive elsewhere after this copy last synced: kept here, local-only, even
    // when edited. Otherwise the record is stale and the sync goes on: a copy with no Drive file
    // was sent again from this device, and a detachment older than the last sync was overtaken by
    // a later upload.
    const detachedAt = state ? remoteDetached[id] : undefined
    if (state && detachedAt !== undefined) {
      if (state.remoteFileId !== undefined && detachedAt > (state.lastSyncedAt ?? 0)) {
        actions.push({ kind: 'markLocalOnly', id })
        continue
      }
      actions.push(...planSynced(id, state, file, remoteDeleted), { kind: 'forgetDetached', id })
      continue
    }

    actions.push(...planSynced(id, state, file, remoteDeleted))
  }
  return actions
}

type RemoteEntry = PlanInput['remote'][string]

/** The rules for a collection in the sync. */
function planSynced(
  id: string,
  state: SyncState | undefined,
  file: RemoteEntry | undefined,
  remoteDeleted: Record<string, number>,
): Action[] {
  // 4. Deleted elsewhere: drop a clean copy; a local edit wins.
  if (state && id in remoteDeleted) {
    return state.dirty
      ? [
          { kind: 'push', id },
          { kind: 'forgetTombstone', id },
        ]
      : [{ kind: 'deleteLocal', id }]
  }

  // 5. Not on the Drive: never uploaded, or the file vanished. When in doubt, keep the collection.
  if (state && !file) return [{ kind: 'push', id }]

  // 6. Remote only. A stale remoteDeleted entry does not block the pull: the file exists, so it
  // was re-created after the deletion was recorded.
  if (!state && file) return [{ kind: 'pull', id, fileId: file.fileId, version: file.version }]

  // 7. Both sides.
  if (state && file) {
    // A new version holding exactly what this device sent last (only the Drive's metadata moved)
    // is no change of content.
    const sameContent = file.md5 !== undefined && file.md5 === state.remoteMd5
    const remoteChanged = file.version !== state.remoteVersion && !sameContent
    if (remoteChanged && state.dirty) {
      return [{ kind: 'conflict', id, fileId: file.fileId, version: file.version }]
    }
    if (remoteChanged) return [{ kind: 'pull', id, fileId: file.fileId, version: file.version }]
    if (state.dirty) return [{ kind: 'push', id }]
  }
  return []
}
