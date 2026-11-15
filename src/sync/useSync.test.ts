import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand'
import type { EditorState } from '../state/editor'
import type { Store } from '../storage/store'
import type { Account } from '../ui/account/account'
import type { SyncEngine } from './engine'
import { useSyncStatus } from './status'
import { answerOtherOwner, startSync, syncNow, useOtherOwner } from './useSync'

const ANA: Account = {
  id: 'ana',
  email: 'ana@example.com',
  name: 'Ana',
  picture: null,
  drive: true,
}

type FakeEditor = Pick<
  EditorState,
  'collection' | 'savedSizes' | 'folders' | 'localEdits' | 'flush' | 'reloadFromStore'
>

let calls: string[]
let editor: StoreApi<FakeEditor>
let engine: { run: ReturnType<typeof vi.fn>; downloadMissingPhotos: ReturnType<typeof vi.fn> }
let meta: Map<string, string | boolean>
let others: { id: string; email: string; count: number }[]
let store: Store
let stop: (() => void) | undefined

function collection(photoIds: string[] = []) {
  return {
    schemaVersion: 1 as const,
    id: 'c1',
    name: 'C1',
    photoIds,
    frames: [],
    paper: { widthMm: 210, heightMm: 297, marginMm: 5, gapMm: 2 },
    updatedAt: 1,
  }
}

function begin(account: Account = ANA) {
  const sync = startSync(account, {
    store,
    editor: editor as unknown as StoreApi<EditorState>,
    createEngine: () => engine as unknown as SyncEngine,
  })
  stop = sync.stop
  return sync
}

/** Lets pending promises settle without moving the fake clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  meta = new Map()
  others = []
  useSyncStatus.setState({ state: 'off', error: undefined, changeCount: 0, changedIds: [] })
  useOtherOwner.setState({ other: null })
  editor = createStore<FakeEditor>()(() => ({
    collection: collection(['p1']),
    savedSizes: [],
    folders: [],
    localEdits: 0,
    flush: vi.fn(async () => void calls.push('flush')),
    reloadFromStore: vi.fn(async (ids: string[]) => void calls.push(`reload:${ids.join(',')}`)),
  }))
  engine = {
    run: vi.fn(async () => void calls.push('run')),
    downloadMissingPhotos: vi.fn(async () => {}),
  }
  store = {
    setOwner: vi.fn(async () => void calls.push('owner')),
    listOtherOwners: vi.fn(async () => others),
    getMeta: vi.fn(async (k: string) => meta.get(k)),
    setMeta: vi.fn(async (k: string, v: string | boolean) => void meta.set(k, v)),
    claimCollections: vi.fn(async (id: string) => void calls.push(`claim:${id}`)),
  } as unknown as Store
})

afterEach(() => {
  stop?.()
  stop = undefined
  setVisibility('visible')
  vi.useRealTimers()
})

describe('startSync triggers', () => {
  it('sets the owner, flushes the editor, then runs with the open collection first', async () => {
    begin()
    await settle()
    expect(calls).toEqual(['owner', 'flush', 'run'])
    expect(store.setOwner).toHaveBeenCalledWith({ id: 'ana', email: 'ana@example.com' })
    expect(engine.run).toHaveBeenCalledWith(['p1'])
  })

  it('runs again when the page becomes visible, not when it hides', async () => {
    begin()
    await settle()
    setVisibility('hidden')
    await settle()
    expect(engine.run).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await settle()
    expect(engine.run).toHaveBeenCalledTimes(2)
  })

  it('runs again when the connection comes back', async () => {
    begin()
    await settle()
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(engine.run).toHaveBeenCalledTimes(2)
  })

  it('runs 4 s after the last local change', async () => {
    begin()
    await settle()
    editor.setState({ collection: { ...collection(['p1']), name: 'a' } })
    await vi.advanceTimersByTimeAsync(3000)
    editor.setState({ savedSizes: [] })
    await vi.advanceTimersByTimeAsync(3999)
    expect(engine.run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(engine.run).toHaveBeenCalledTimes(2)
    expect(calls.slice(-2)).toEqual(['flush', 'run'])
  })

  it('runs on the button', async () => {
    begin()
    await settle()
    await syncNow()
    expect(engine.run).toHaveBeenCalledTimes(2)
  })

  it('a trigger during a pass runs one more pass after it', async () => {
    let release = () => {}
    engine.run.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
    begin()
    await settle()
    void syncNow()
    void syncNow()
    await settle()
    expect(engine.run).toHaveBeenCalledTimes(1)
    release()
    await settle()
    expect(engine.run).toHaveBeenCalledTimes(2)
  })

  it('reloads the editor with what the sync changed', async () => {
    engine.run.mockImplementation(async () => {
      calls.push('run')
      useSyncStatus.setState((s) => ({ changeCount: s.changeCount + 1, changedIds: ['c1', 'c2'] }))
    })
    begin()
    await settle()
    expect(calls).toEqual(['owner', 'flush', 'run', 'reload:c1,c2'])
  })

  it('a reload does not count as a local change', async () => {
    editor.setState({
      reloadFromStore: vi.fn(async () => editor.setState({ savedSizes: [], folders: [] })),
    })
    engine.run.mockImplementation(async () =>
      useSyncStatus.setState((s) => ({ changeCount: s.changeCount + 1, changedIds: ['c1'] })),
    )
    begin()
    await settle()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(engine.run).toHaveBeenCalledTimes(1)
  })

  it('an edit made while a reload is running still schedules a pass', async () => {
    let finish = () => {}
    editor.setState({
      reloadFromStore: vi.fn(async () => {
        editor.setState({ savedSizes: [], folders: [] })
        await new Promise<void>((resolve) => (finish = resolve))
      }),
    })
    engine.run.mockImplementationOnce(async () =>
      useSyncStatus.setState((s) => ({ changeCount: s.changeCount + 1, changedIds: ['c1'] })),
    )
    begin()
    await settle()
    // The person edits during the reload.
    editor.setState((s) => ({
      collection: { ...collection(['p1']), name: 'edited' },
      localEdits: s.localEdits + 1,
    }))
    finish()
    await settle()
    await vi.advanceTimersByTimeAsync(3999)
    expect(engine.run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(engine.run).toHaveBeenCalledTimes(2)
  })

  it('without Drive access: needsDrive and nothing runs', async () => {
    begin({ ...ANA, drive: false })
    await settle()
    expect(useSyncStatus.getState().state).toBe('needsDrive')
    setVisibility('visible')
    editor.setState({ savedSizes: [] })
    await vi.advanceTimersByTimeAsync(10_000)
    await syncNow()
    expect(engine.run).not.toHaveBeenCalled()
    expect(store.setOwner).toHaveBeenCalled()
  })

  it('an account still identified by its e-mail (saved before ids) never sets the owner', async () => {
    others = [{ id: 'bia', email: 'bia@example.com', count: 1 }]
    begin({ ...ANA, id: ANA.email, drive: false })
    await settle()
    expect(store.setOwner).not.toHaveBeenCalled()
    expect(useSyncStatus.getState().state).toBe('needsDrive')
    expect(useOtherOwner.getState().other).toBeNull()
    editor.setState({ savedSizes: [] })
    await vi.advanceTimersByTimeAsync(10_000)
    await syncNow()
    expect(engine.run).not.toHaveBeenCalled()
  })

  it('an account still identified by its e-mail does not sync even with Drive', async () => {
    begin({ ...ANA, id: ANA.email })
    await settle()
    expect(store.setOwner).not.toHaveBeenCalled()
    expect(engine.run).not.toHaveBeenCalled()
    expect(useSyncStatus.getState().state).toBe('off')
  })

  it('stops every trigger', async () => {
    const sync = begin()
    await settle()
    sync.stop()
    setVisibility('visible')
    editor.setState({ savedSizes: [] })
    await vi.advanceTimersByTimeAsync(10_000)
    await syncNow()
    expect(engine.run).toHaveBeenCalledTimes(1)
  })
})

describe('collections of another account', () => {
  const BIA = { id: 'bia', email: 'bia@example.com', count: 3 }

  it('asks about another owner not answered yet', async () => {
    others = [BIA]
    begin()
    await settle()
    expect(useOtherOwner.getState().other).toEqual(BIA)
  })

  it('does not ask again once answered for this pair of accounts', async () => {
    others = [BIA]
    meta.set('otherAccountAnswer:ana:bia', 'keep')
    begin()
    await settle()
    expect(useOtherOwner.getState().other).toBeNull()
  })

  it('"Deixar" remembers the answer and changes nothing', async () => {
    others = [BIA]
    begin()
    await settle()
    await answerOtherOwner('keep')
    expect(meta.get('otherAccountAnswer:ana:bia')).toBe('keep')
    expect(store.claimCollections).not.toHaveBeenCalled()
    expect(useOtherOwner.getState().other).toBeNull()
  })

  it('"Copiar" claims the collections and syncs', async () => {
    others = [BIA]
    begin()
    await settle()
    calls = []
    await answerOtherOwner('copy')
    expect(meta.get('otherAccountAnswer:ana:bia')).toBe('copy')
    // The list re-reads: the claimed collections now show.
    expect(calls).toEqual(['claim:bia', 'reload:', 'flush', 'run'])
  })

  it('claims silently the collections stamped with the same e-mail', async () => {
    others = [{ id: 'ana@example.com', email: 'ana@example.com', count: 2 }, BIA]
    begin()
    await settle()
    expect(calls).toContain('claim:ana@example.com')
    expect(store.claimCollections).toHaveBeenCalledTimes(1)
    expect(useOtherOwner.getState().other).toEqual(BIA)
    // The list re-reads and the claimed collections sync.
    expect(calls.filter((c) => c === 'run').length).toBeGreaterThanOrEqual(2)
  })

  it('asks about the next owner after an answer', async () => {
    others = [BIA, { id: 'caio', email: 'caio@example.com', count: 1 }]
    begin()
    await settle()
    await answerOtherOwner('keep')
    expect(useOtherOwner.getState().other?.id).toBe('caio')
  })
})
