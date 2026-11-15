import { describe, expect, it } from 'vitest'
import { planCollections } from './plan'
import type { SyncState, Tombstone } from '../storage/store'

const base = {
  local: {} as Record<string, SyncState>,
  remote: {} as Record<string, { fileId: string; version: string; md5?: string }>,
  remoteDeleted: {} as Record<string, number>,
  localTombstones: [] as Tombstone[],
  remoteDetached: {} as Record<string, number>,
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

  it('rule 5: a different file of the id, even at the same version, is a remote change', () => {
    // Sent again from another device after its removal: a new file whose version starts over.
    expect(
      plan({
        local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1', remoteMd5: 'm1' } },
        remote: { a: { fileId: 'f2', version: '1', md5: 'm2' } },
      }),
    ).toEqual([{ kind: 'pull', id: 'a', fileId: 'f2', version: '1' }])
    expect(
      plan({
        local: { a: { dirty: true, remoteFileId: 'f1', remoteVersion: '1', remoteMd5: 'm1' } },
        remote: { a: { fileId: 'f2', version: '1', md5: 'm2' } },
      }),
    ).toEqual([{ kind: 'conflict', id: 'a', fileId: 'f2', version: '1' }])
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

  it('rule 5: a new version with what this device sent last, and nothing local, needs nothing', () => {
    expect(
      plan({
        local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1', remoteMd5: 'm1' } },
        remote: { a: { fileId: 'f1', version: '2', md5: 'm1' } },
      }),
    ).toEqual([])
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

  describe('local-only collections', () => {
    it('a local-only collection whose own file is on the Drive detaches it', () => {
      expect(
        plan({
          local: { a: { dirty: false, localOnly: true, remoteFileId: 'f1', remoteVersion: '1' } },
          remote: { a: { fileId: 'f1', version: '4' } },
        }),
      ).toEqual([{ kind: 'detachRemote', id: 'a', fileId: 'f1' }])
    })

    it('a local-only collection never trashes a different file of the same id', () => {
      // Another device sent it again ("Enviar"): that new file is not this device's to trash.
      expect(
        plan({
          local: { a: { dirty: false, localOnly: true, remoteFileId: 'f1', remoteVersion: '1' } },
          remote: { a: { fileId: 'f2', version: '4' } },
        }),
      ).toEqual([])
    })

    it('a local-only collection never pushes, pulls nor conflicts', () => {
      expect(
        plan({
          local: {
            never: { dirty: true, localOnly: true },
            gone: { dirty: true, localOnly: true, remoteFileId: 'f1', remoteVersion: '1' },
            edited: { dirty: true, localOnly: true },
          },
          remote: { edited: { fileId: 'f9', version: '2' } },
        }),
      ).toEqual([])
    })

    it('a local-only collection deleted elsewhere is kept', () => {
      expect(
        plan({
          local: { a: { dirty: false, localOnly: true } },
          remoteDeleted: { a: 10 },
        }),
      ).toEqual([])
    })

    it('a synced copy whose file is gone and detached marks the collection local-only', () => {
      expect(
        plan({
          local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1' } },
          remoteDetached: { a: 10 },
        }),
      ).toEqual([{ kind: 'markLocalOnly', id: 'a' }])
    })

    it('a dirty copy is marked local-only too, never pushed back', () => {
      expect(
        plan({
          local: { a: { dirty: true, remoteFileId: 'f1', remoteVersion: '1' } },
          remoteDetached: { a: 10 },
        }),
      ).toEqual([{ kind: 'markLocalOnly', id: 'a' }])
    })

    it('while the file is still listed, a detached copy syncs as usual and keeps the record', () => {
      expect(
        plan({
          local: { a: { dirty: true, remoteFileId: 'f1', remoteVersion: '1' } },
          remote: { a: { fileId: 'f1', version: '2' } },
          remoteDetached: { a: 10 },
        }),
      ).toEqual([{ kind: 'conflict', id: 'a', fileId: 'f1', version: '2' }])
      expect(
        plan({
          local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1' } },
          remote: { a: { fileId: 'f1', version: '1' } },
          remoteDetached: { a: 10 },
        }),
      ).toEqual([])
    })

    it('a detachment wins over a deletion record: the copy is kept', () => {
      expect(
        plan({
          local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1' } },
          remoteDeleted: { a: 8 },
          remoteDetached: { a: 10 },
        }),
      ).toEqual([{ kind: 'markLocalOnly', id: 'a' }])
    })

    it('a collection sent again pushes and forgets its detachment', () => {
      expect(
        plan({
          local: { a: { dirty: true } },
          remoteDetached: { a: 10 },
        }),
      ).toEqual([
        { kind: 'push', id: 'a' },
        { kind: 'forgetDetached', id: 'a' },
      ])
    })

    it('a collection sent again before its removal ran pushes and forgets its detachment', () => {
      const resent = { dirty: true, resent: true, remoteFileId: 'f1', remoteVersion: '1' }
      // The removal was cut short before the trash: the file is still there.
      expect(
        plan({
          local: { a: resent },
          remote: { a: { fileId: 'f1', version: '1' } },
          remoteDetached: { a: 10 },
        }),
      ).toEqual([
        { kind: 'push', id: 'a' },
        { kind: 'forgetDetached', id: 'a' },
      ])
      // Cut short after the trash: the file is gone, yet the collection is not made local-only.
      expect(plan({ local: { a: resent }, remoteDetached: { a: 10 } })).toEqual([
        { kind: 'push', id: 'a' },
        { kind: 'forgetDetached', id: 'a' },
      ])
      // The removal never started: a plain push over the same file.
      expect(plan({ local: { a: resent }, remote: { a: { fileId: 'f1', version: '1' } } })).toEqual(
        [{ kind: 'push', id: 'a' }],
      )
    })

    it('a detachment record does not stop a pull of a file that exists', () => {
      expect(
        plan({ remote: { a: { fileId: 'f1', version: '2' } }, remoteDetached: { a: 10 } }),
      ).toEqual([{ kind: 'pull', id: 'a', fileId: 'f1', version: '2' }])
    })

    it('remoteDetached is optional and defaults to none', () => {
      expect(
        planCollections({
          local: { a: { dirty: true } },
          remote: {},
          remoteDeleted: {},
          localTombstones: [],
        }),
      ).toEqual([{ kind: 'push', id: 'a' }])
    })

    it('no local-only scenario ever deletes a local copy', () => {
      const scenarios: Partial<typeof base>[] = [
        { local: { a: { dirty: false, localOnly: true } }, remoteDeleted: { a: 10 } },
        {
          local: { a: { dirty: false, localOnly: true, remoteFileId: 'f1' } },
          remote: { a: { fileId: 'f1', version: '1' } },
          remoteDeleted: { a: 10 },
          remoteDetached: { a: 10 },
        },
        {
          local: { a: { dirty: false, localOnly: true, remoteFileId: 'f1' } },
          remote: { a: { fileId: 'f2', version: '1' } },
          remoteDeleted: { a: 10 },
        },
        {
          local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1' } },
          remoteDeleted: { a: 10 },
          remoteDetached: { a: 10 },
        },
        {
          local: { a: { dirty: false, remoteFileId: 'f1', remoteVersion: '1' } },
          remote: { a: { fileId: 'f1', version: '1' } },
          remoteDetached: { a: 10 },
        },
        { local: { a: { dirty: true } }, remoteDetached: { a: 10 } },
        { local: { a: { dirty: false, localOnly: true } }, remoteDetached: { a: 10 } },
      ]
      for (const s of scenarios) {
        expect(plan(s).map((x) => x.kind)).not.toContain('deleteLocal')
      }
    })
  })
})
