import { describe, expect, it } from 'vitest'
import { planCollections } from './plan'
import type { SyncState, Tombstone } from '../storage/store'

const base = {
  local: {} as Record<string, SyncState>,
  remote: {} as Record<string, { fileId: string; version: string; md5?: string }>,
  remoteDeleted: {} as Record<string, number>,
  localTombstones: [] as Tombstone[],
}
const plan = (over: Partial<typeof base>) => planCollections({ ...base, ...over })
const tomb = (id: string, remoteFileId?: string): Tombstone => ({
  kind: 'collection',
  id,
  at: 1,
  remoteFileId,
})

describe('planCollections', () => {
  it('rule 1: local tombstone with a remote file trashes that file', () => {
    expect(
      plan({
        localTombstones: [tomb('a', 'f1')],
        remote: { a: { fileId: 'f1', version: '3' } },
      }),
    ).toEqual([{ kind: 'trashRemote', id: 'a', fileId: 'f1' }])
  })

  it('rule 1: local tombstone whose file is already gone is only forgotten', () => {
    expect(plan({ localTombstones: [tomb('a', 'f1')] })).toEqual([
      { kind: 'forgetTombstone', id: 'a' },
    ])
  })

  it('rule 1: local tombstone without a remoteFileId is only forgotten', () => {
    expect(
      plan({ localTombstones: [tomb('a')], remote: { a: { fileId: 'f1', version: '3' } } }),
    ).toEqual([{ kind: 'forgetTombstone', id: 'a' }])
  })

  it('rule 2: remote deleted and local clean deletes the local copy', () => {
    expect(
      plan({
        local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1' } },
        remoteDeleted: { a: 10 },
      }),
    ).toEqual([{ kind: 'deleteLocal', id: 'a' }])
  })

  it('rule 2: remote deleted but local edited pushes and forgets the tombstone (edit wins)', () => {
    expect(
      plan({
        local: { a: { dirty: true, remoteFileId: 'f1', remoteVersion: '1' } },
        remoteDeleted: { a: 10 },
      }),
    ).toEqual([
      { kind: 'push', id: 'a' },
      { kind: 'forgetTombstone', id: 'a' },
    ])
  })

  it('rule 3: local only, never uploaded, pushes', () => {
    expect(plan({ local: { a: { dirty: true } } })).toEqual([{ kind: 'push', id: 'a' }])
  })

  it('rule 3: local only with an empty state (saved before sync) pushes', () => {
    expect(plan({ local: { a: { dirty: false } } })).toEqual([{ kind: 'push', id: 'a' }])
  })

  it('rule 3: uploaded but the file vanished without a tombstone pushes again', () => {
    expect(
      plan({ local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1' } } }),
    ).toEqual([{ kind: 'push', id: 'a' }])
  })

  it('rule 4: remote only without a tombstone pulls', () => {
    expect(plan({ remote: { a: { fileId: 'f1', version: '2' } } })).toEqual([
      { kind: 'pull', id: 'a', fileId: 'f1', version: '2' },
    ])
  })

  it('rule 5: only the remote changed pulls', () => {
    expect(
      plan({
        local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1' } },
        remote: { a: { fileId: 'f1', version: '2' } },
      }),
    ).toEqual([{ kind: 'pull', id: 'a', fileId: 'f1', version: '2' }])
  })

  it('rule 5: only the local changed pushes', () => {
    expect(
      plan({
        local: { a: { dirty: true, remoteFileId: 'f1', remoteVersion: '1' } },
        remote: { a: { fileId: 'f1', version: '1' } },
      }),
    ).toEqual([{ kind: 'push', id: 'a' }])
  })

  it('rule 5: both changed is a conflict', () => {
    expect(
      plan({
        local: { a: { dirty: true, remoteFileId: 'f1', remoteVersion: '1' } },
        remote: { a: { fileId: 'f1', version: '2' } },
      }),
    ).toEqual([{ kind: 'conflict', id: 'a', fileId: 'f1', version: '2' }])
  })

  it('rule 5: a new version whose content is what this device sent last is only a local change', () => {
    expect(
      plan({
        local: { a: { dirty: true, remoteFileId: 'f1', remoteVersion: '1', remoteMd5: 'm1' } },
        remote: { a: { fileId: 'f1', version: '2', md5: 'm1' } },
      }),
    ).toEqual([{ kind: 'push', id: 'a' }])
  })

  it('rule 5: a different or unknown checksum is still a conflict', () => {
    for (const [mine, theirs] of [
      ['m1', 'm2'],
      [undefined, 'm1'],
      ['m1', undefined],
      [undefined, undefined],
    ]) {
      expect(
        plan({
          local: { a: { dirty: true, remoteFileId: 'f1', remoteVersion: '1', remoteMd5: mine } },
          remote: { a: { fileId: 'f1', version: '2', md5: theirs } },
        }),
      ).toEqual([{ kind: 'conflict', id: 'a', fileId: 'f1', version: '2' }])
    }
  })

  it('rule 5: nothing changed means no action', () => {
    expect(
      plan({
        local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1' } },
        remote: { a: { fileId: 'f1', version: '1' } },
      }),
    ).toEqual([])
  })

  it('a local state without remoteVersion counts the remote as changed', () => {
    expect(
      plan({
        local: { a: { dirty: false, remoteFileId: 'f1' } },
        remote: { a: { fileId: 'f1', version: '1' } },
      }),
    ).toEqual([{ kind: 'pull', id: 'a', fileId: 'f1', version: '1' }])
  })

  it('orders actions by id', () => {
    const ids = plan({ local: { b: { dirty: true }, a: { dirty: true } } }).map((x) => x.id)
    expect(ids).toEqual(['a', 'b'])
  })

  it('rule 2: remoteDeleted entry with the remote file still present and local clean deletes locally', () => {
    // The file can linger in the listing; the engine removes the record when it re-pushes.
    expect(
      plan({
        local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1' } },
        remote: { a: { fileId: 'f1', version: '1' } },
        remoteDeleted: { a: 10 },
      }),
    ).toEqual([{ kind: 'deleteLocal', id: 'a' }])
  })

  it('rule 4: remote only with a stale remoteDeleted entry still pulls', () => {
    expect(
      plan({ remote: { a: { fileId: 'f1', version: '2' } }, remoteDeleted: { a: 10 } }),
    ).toEqual([{ kind: 'pull', id: 'a', fileId: 'f1', version: '2' }])
  })

  it('rule 1 wins when a local tombstone and a local state exist for the same id', () => {
    expect(
      plan({
        local: { a: { dirty: true, remoteFileId: 'f1', remoteVersion: '1' } },
        localTombstones: [tomb('a', 'f1')],
        remote: { a: { fileId: 'f1', version: '1' } },
      }),
    ).toEqual([{ kind: 'trashRemote', id: 'a', fileId: 'f1' }])
  })
})
