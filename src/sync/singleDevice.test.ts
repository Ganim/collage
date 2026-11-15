import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand'
import type { Decode } from '../photos/import'
import { createEditorStore, type EditorState } from '../state/editor'
import { createIdbStore } from '../storage/indexeddb'
import type { Store } from '../storage/store'
import type { Account } from '../ui/account/account'
import { createSyncEngine } from './engine'
import { createFakeDrive, type FakeDrive } from './fakeDrive'
import { useSyncStatus } from './status'
import { startSync, syncNow } from './useSync'

/**
 * One person, one device: the real editor, store, engine and session against a fake Drive. Editing
 * a collection between passes must never leave a "(cópia de outro aparelho)" behind.
 */

const ANA: Account = {
  id: 'ana',
  email: 'ana@example.com',
  name: 'Ana',
  picture: null,
  drive: true,
}
const SUFFIX = ' (cópia de outro aparelho)'

const decode: Decode = async () => ({
  width: 400,
  height: 300,
  preview: new Blob(['p'], { type: 'image/jpeg' }),
  thumb: new Blob(['t'], { type: 'image/jpeg' }),
})

let n = 0
let store: Store
let editor: StoreApi<EditorState>
let drive: FakeDrive
let stop: (() => void) | undefined

async function setup(options: { bumpVersionAfterWrite: boolean; ownerFirst?: boolean }) {
  useSyncStatus.setState({ state: 'off', error: undefined, changeCount: 0, changedIds: [] })
  store = await createIdbStore(`single-device-${n++}`)
  if (options.ownerFirst !== false) await store.setOwner({ id: ANA.id, email: ANA.email })
  editor = createEditorStore(store)
  await editor.getState().bootstrap()
  drive = createFakeDrive({ bumpVersionAfterWrite: options.bumpVersionAfterWrite })
}

function begin() {
  stop = startSync(ANA, {
    store,
    editor,
    createEngine: () => createSyncEngine({ store, drive, decode }),
  }).stop
}

const names = async () => (await store.listCollections()).map((c) => c.name).sort()
const copies = async () => (await names()).filter((name) => name.endsWith(SUFFIX))
const edit = (name: string) => editor.getState().renameCollection(name)

/** Opens a new collection with one frame, saved and uploaded. */
async function openNewCollection() {
  await editor.getState().newCollection()
  editor.getState().addFrame({ widthMm: 100, heightMm: 150 })
  edit('Minha')
  await syncNow()
  expect(useSyncStatus.getState().state).toBe('idle')
}

afterEach(() => {
  stop?.()
  stop = undefined
})

describe.each([
  ['a Drive that keeps the version it answered', false],
  ['a Drive that bumps the version after the upload (like Google)', true],
])('one device, %s', (_label, bumpVersionAfterWrite) => {
  beforeEach(async () => {
    await setup({ bumpVersionAfterWrite })
    begin()
    await syncNow()
  })

  it('edit, pass, edit again, go back: no copy', async () => {
    await openNewCollection()
    edit('Editada 1')
    await syncNow()
    edit('Editada 2')
    await editor.getState().closeCollection()
    await syncNow()
    await syncNow()
    expect(await copies()).toEqual([])
    expect(await names()).toEqual(['Editada 2'])
    expect(
      [...drive.files.values()].filter((f) => f.appProperties.kind === 'collection'),
    ).toHaveLength(1)
  })

  it('many edit and pass rounds, then reopening and editing: no copy', async () => {
    await openNewCollection()
    const id = editor.getState().collection.id
    for (let i = 0; i < 4; i++) {
      edit(`Volta ${i}`)
      await syncNow()
    }
    await editor.getState().closeCollection()
    await syncNow()
    expect(await editor.getState().openCollection(id)).toBe(true)
    edit('Reaberta')
    await editor.getState().closeCollection()
    await syncNow()
    expect(await names()).toEqual(['Reaberta'])
  })

  it('an edit made while a pass is running: no copy', async () => {
    await openNewCollection()
    edit('Antes')
    const running = syncNow()
    edit('Durante')
    await running
    edit('Depois')
    await editor.getState().closeCollection()
    await syncNow()
    await syncNow()
    expect(await names()).toEqual(['Depois'])
  })
})

describe('one device, an old collection saved before the account was connected', () => {
  it.each([false, true])(
    'its first sync and the edits after it make no copy (bump %s)',
    async (bumpVersionAfterWrite) => {
      await setup({ bumpVersionAfterWrite, ownerFirst: false })
      await editor.getState().newCollection()
      editor.getState().addFrame({ widthMm: 100, heightMm: 150 })
      edit('Antiga')
      await editor.getState().flush()
      expect(
        (await store.getSyncStates())[editor.getState().collection.id]?.ownerId,
      ).toBeUndefined()

      begin()
      await syncNow()
      edit('Antiga editada')
      await syncNow()
      edit('Antiga editada 2')
      await editor.getState().closeCollection()
      await syncNow()
      expect(await names()).toEqual(['Antiga editada 2'])
    },
  )
})
