import { useEffect } from 'react'
import { create, type StoreApi } from 'zustand'
import { appEditor, appStorage, type EditorState } from '../state/editor'
import type { Store } from '../storage/store'
import { getDriveToken, type Account } from '../ui/account/account'
import { createDrive } from './drive'
import { createSyncEngine, type SyncEngine } from './engine'
import { useSyncStatus } from './status'

/** A pass starts this long after the last local change. */
export const CHANGE_DELAY_MS = 4000

export interface OtherOwner {
  id: string
  email: string
  count: number
}

/** The other account whose collections this device holds, waiting for the person's answer. */
export const useOtherOwner = create<{ other: OtherOwner | null }>()(() => ({ other: null }))

export type OtherOwnerAnswer = 'copy' | 'keep'

export interface SyncDeps {
  store: Store
  editor: StoreApi<EditorState>
  createEngine: () => SyncEngine
}

interface Session {
  trigger(): Promise<void>
  answer(answer: OtherOwnerAnswer): Promise<void>
}

/** The running session; the account menu and the other-account sheet talk to it. */
let session: Session | null = null

/** "Sincronizar agora". Does nothing without a session or without Drive access. */
export function syncNow(): Promise<void> {
  return session?.trigger() ?? Promise.resolve()
}

/** The answer to the other-account question that is showing. */
export function answerOtherOwner(answer: OtherOwnerAnswer): Promise<void> {
  return session?.answer(answer) ?? Promise.resolve()
}

const answerKey = (currentId: string, otherId: string) =>
  `otherAccountAnswer:${currentId}:${otherId}`

/**
 * Starts syncing for the account: sets it as the owner, then runs a pass now, when the page
 * comes back, when the connection returns and 4 s after the last local change. Each pass first
 * flushes the editor. Without Drive access the status is needsDrive and nothing runs.
 */
export function startSync(
  account: Pick<Account, 'id' | 'email' | 'drive'>,
  deps: SyncDeps,
): { stop(): void } {
  const { store, editor } = deps
  const withDrive = account.drive
  const engine = withDrive ? deps.createEngine() : null
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let active: Promise<void> | null = null
  let again = false
  let reloading = 0

  const ownerSet = store
    .setOwner({ id: account.id, email: account.email })
    .catch((e: unknown) => console.error(e))

  async function pass(): Promise<void> {
    await ownerSet
    if (stopped || !engine) return
    try {
      await editor.getState().flush()
    } catch (e) {
      // The editor shows its own banner; what is on disk still syncs.
      console.error(e)
    }
    if (stopped) return
    await engine.run(editor.getState().collection.photoIds)
  }

  function trigger(): Promise<void> {
    if (stopped || !engine) return Promise.resolve()
    clearTimeout(timer)
    timer = undefined
    // A pass already running may have read the store before this change: one more after it.
    if (active) {
      again = true
      return active
    }
    active = (async () => {
      do {
        again = false
        await pass()
      } while (again && !stopped)
    })().finally(() => {
      active = null
    })
    return active
  }

  async function reload(changedIds: string[]): Promise<void> {
    reloading++
    try {
      await editor.getState().reloadFromStore(changedIds)
    } catch (e) {
      console.error(e)
    } finally {
      reloading--
    }
  }

  async function askNext(): Promise<void> {
    await ownerSet
    try {
      for (const other of await store.listOtherOwners()) {
        if (stopped) return
        if ((await store.getMeta(answerKey(account.id, other.id))) !== undefined) continue
        if (!stopped) useOtherOwner.setState({ other })
        return
      }
      if (!stopped) useOtherOwner.setState({ other: null })
    } catch (e) {
      console.error(e)
    }
  }

  async function answer(choice: OtherOwnerAnswer): Promise<void> {
    const other = useOtherOwner.getState().other
    if (!other || stopped) return
    useOtherOwner.setState({ other: null })
    try {
      await store.setMeta(answerKey(account.id, other.id), choice)
      if (choice === 'copy') {
        await store.claimCollections(other.id)
        // The claimed collections now belong to this account: the list shows them.
        useSyncStatus.setState((s) => ({ changeCount: s.changeCount + 1, changedIds: [] }))
        await trigger()
      }
    } catch (e) {
      console.error(e)
    }
    await askNext()
  }

  const unsubscribeStatus = useSyncStatus.subscribe((s, prev) => {
    if (s.changeCount !== prev.changeCount) void reload(s.changedIds)
  })
  const unsubscribeEditor = editor.subscribe((s, prev) => {
    if (reloading > 0) return
    if (
      s.collection === prev.collection &&
      s.savedSizes === prev.savedSizes &&
      s.folders === prev.folders
    )
      return
    if (stopped || !engine) return
    clearTimeout(timer)
    timer = setTimeout(() => void trigger(), CHANGE_DELAY_MS)
  })
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void trigger()
  }
  const onOnline = () => void trigger()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)

  const mine: Session = { trigger, answer }
  session = mine
  if (withDrive) void trigger()
  else useSyncStatus.setState({ state: 'needsDrive', error: undefined, photos: undefined })
  void askNext()

  return {
    stop() {
      stopped = true
      clearTimeout(timer)
      unsubscribeStatus()
      unsubscribeEditor()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      if (session === mine) session = null
      useOtherOwner.setState({ other: null })
      useSyncStatus.setState({ state: 'off', error: undefined, photos: undefined })
    },
  }
}

/** Syncs the signed-in account for as long as the workspace is on screen. */
export function useSync(account: Account): void {
  const { id, email, drive } = account
  useEffect(() => {
    const store = appStorage()
    const sync = startSync(
      { id, email, drive },
      {
        store,
        editor: appEditor(),
        createEngine: () =>
          createSyncEngine({
            store,
            drive: createDrive((force) =>
              getDriveToken(undefined, force).then((t) => t.accessToken),
            ),
          }),
      },
    )
    return sync.stop
  }, [id, email, drive])
}
