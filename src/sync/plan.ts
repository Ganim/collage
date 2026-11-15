import type { SyncState, Tombstone } from '../storage/store'

/**
 * `forgetTombstone(id)` means: drop id from library.json `deleted.collection` AND from the local
 * tombstones, if present in either (see forgetCollectionDeletion in library.ts).
 */
export type Action =
  | { kind: 'push'; id: string }
  | { kind: 'pull'; id: string; fileId: string; version: string }
  | { kind: 'conflict'; id: string; fileId: string; version: string }
  | { kind: 'deleteLocal'; id: string }
  | { kind: 'trashRemote'; id: string; fileId: string }
  | { kind: 'forgetTombstone'; id: string }

export interface PlanInput {
  /** Every local collection of the current account. A missing remoteFileId means never uploaded. */
  local: Record<string, SyncState>
  remote: Record<string, { fileId: string; version: string }>
  /** Collection deletions recorded in library.json. */
  remoteDeleted: Record<string, number>
  /** Local tombstones of kind 'collection'. */
  localTombstones: Tombstone[]
}

/** Decides what to do with each collection. Pure and deterministic: actions are ordered by id. */
export function planCollections(input: PlanInput): Action[] {
  const { local, remote, remoteDeleted, localTombstones } = input
  const tombstones = new Map<string, Tombstone>()
  for (const t of localTombstones) if (t.kind === 'collection') tombstones.set(t.id, t)

  const ids = new Set<string>([...Object.keys(local), ...Object.keys(remote), ...tombstones.keys()])
  const actions: Action[] = []

  for (const id of [...ids].sort()) {
    const state = local[id] as SyncState | undefined
    const file = remote[id] as { fileId: string; version: string } | undefined
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

    // 2. Deleted elsewhere: drop a clean copy; a local edit wins.
    if (state && id in remoteDeleted) {
      if (state.dirty) {
        actions.push({ kind: 'push', id }, { kind: 'forgetTombstone', id })
      } else {
        actions.push({ kind: 'deleteLocal', id })
      }
      continue
    }

    // 3. Local only: never uploaded, or the file vanished. When in doubt, keep the collection.
    if (state && !file) {
      actions.push({ kind: 'push', id })
      continue
    }

    // 4. Remote only. A stale remoteDeleted entry does not block the pull: the file exists, so it
    // was re-created after the deletion was recorded.
    if (!state && file) {
      actions.push({ kind: 'pull', id, fileId: file.fileId, version: file.version })
      continue
    }

    // 5. Both sides.
    if (state && file) {
      const remoteChanged = file.version !== state.remoteVersion
      if (remoteChanged && state.dirty) {
        actions.push({ kind: 'conflict', id, fileId: file.fileId, version: file.version })
      } else if (remoteChanged) {
        actions.push({ kind: 'pull', id, fileId: file.fileId, version: file.version })
      } else if (state.dirty) {
        actions.push({ kind: 'push', id })
      }
    }
  }
  return actions
}
