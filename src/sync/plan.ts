import type { SyncState, Tombstone } from '../storage/store'

/**
 * `forgetTombstone(id)` means: drop id from library.json `deleted.collection` AND from the local
 * tombstones, if present in either (see forgetCollectionDeletion in library.ts).
 *
 * `detachRemote(id, fileId)`: this device removed the collection from the Drive and its own file
 * is still listed. Write id to library.json `detached.collection` (recordCollectionDetachment)
 * BEFORE trashing the file; clear the local remoteFileId/remoteVersion only after both succeed,
 * so a pass cut short plans it again.
 *
 * `markLocalOnly(id)`: another device removed the collection from the Drive. Set localOnly and
 * CLEAR remoteFileId/remoteVersion on this device: it is kept, never deleted, and only the
 * removing device trashes the file. (Store.setLocalOnly(id, true) alone keeps remoteFileId: that
 * is what the removing device needs for detachRemote.)
 *
 * `forgetDetached(id)`: drop id from library.json `detached.collection`
 * (forgetCollectionDetachment); planned with the push of a collection sent again ("Enviar"): one
 * whose removal ran (no remoteFileId) or was still pending (`resent`).
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

    // 2. Local-only: out of the sync, never pushed, pulled nor deleted. Only its own file goes to
    // the trash: a different file of the same id was sent again from another device.
    if (state?.localOnly) {
      if (file && state.remoteFileId !== undefined && file.fileId === state.remoteFileId) {
        actions.push({ kind: 'detachRemote', id, fileId: file.fileId })
      }
      continue
    }

    // 3. Removed from the Drive elsewhere: a synced copy whose file is gone is kept here,
    // local-only, even when edited. While the file is still listed, the sync goes on as usual.
    if (state && id in remoteDetached) {
      if (state.remoteFileId === undefined || state.resent) {
        // Sent again from this device ("Enviar"): upload, and drop the record.
        actions.push(...planSynced(id, state, file, remoteDeleted), { kind: 'forgetDetached', id })
        continue
      }
      if (!file) {
        actions.push({ kind: 'markLocalOnly', id })
        continue
      }
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
    // Another file of the id (sent again elsewhere) is a change even at the same version: a
    // file's versions start over.
    const sameContent = file.md5 !== undefined && file.md5 === state.remoteMd5
    const unseen = file.fileId !== state.remoteFileId || file.version !== state.remoteVersion
    const remoteChanged = unseen && !sameContent
    if (remoteChanged && state.dirty) {
      return [{ kind: 'conflict', id, fileId: file.fileId, version: file.version }]
    }
    if (remoteChanged) return [{ kind: 'pull', id, fileId: file.fileId, version: file.version }]
    if (state.dirty) return [{ kind: 'push', id }]
  }
  return []
}
