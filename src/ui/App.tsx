import { useCallback, useEffect, useState } from 'react'
import { getEditorState, useEditor } from '../state/editor'
import { requestPersistentStorage } from '../storage/persist'
import type { Account } from './account/account'
import { useAccount } from './account/useAccount'
import { BuildScreen } from './build/BuildScreen'
import { HomeScreen } from './home/HomeScreen'
import { t, type MessageKey } from './i18n'
import { InstallHint } from './install/InstallHint'
import { useRoute, type Route } from './router'
import { SheetScreen } from './sheet/SheetScreen'
import { StartScreen } from './start/StartScreen'

export function App() {
  const { status, account, signOut } = useAccount()

  if (status === 'checking') return <main className="app" aria-busy="true" />
  if (status === 'out' || !account) {
    return (
      <main className="app">
        <StartScreen />
        <InstallHint />
      </main>
    )
  }
  return <Workspace account={account} onSignOut={() => void signOut()} />
}

const collectionId = (r: Route) => (r.name === 'editor' || r.name === 'share' ? r.id : null)

function Workspace({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const bootstrap = useEditor((s) => s.bootstrap)
  const openCollection = useEditor((s) => s.openCollection)
  const listCollections = useEditor((s) => s.listCollections)
  const saveStatus = useEditor((s) => s.saveStatus)
  const loadFailed = useEditor((s) => s.loadFailed)
  const currentId = useEditor((s) => s.collection.id)
  const [route, navigate] = useRoute()
  // Until sizes and folders are in, the screens would flash empty on every visit.
  const [ready, setReady] = useState(false)
  /** The collection the route names, once it was opened in the editor. */
  const [openedId, setOpenedId] = useState<string | null>(null)
  /** A collection the route names whose reading failed (not a missing one). */
  const [openFailedId, setOpenFailedId] = useState<string | null>(null)
  // A retry passes through 'saving'; the warning stays up until a save really works.
  /** A collection the editor is being taken off (closed or deleted): it is not opened again. */
  const [leavingId, setLeavingId] = useState<string | null>(null)
  /** A message for the list, shown when it was sent there (a missing collection, a failed delete). */
  const [notice, setNotice] = useState<MessageKey | null>(null)
  const dismissNotice = useCallback(() => setNotice(null), [])
  const [saveFailed, setSaveFailed] = useState(false)
  if (saveStatus === 'full' && !saveFailed) setSaveFailed(true)
  if (saveStatus === 'saved' && saveFailed) setSaveFailed(false)

  const wantedId = collectionId(route)
  // Deleted from the list, or another one opened since: it has to be opened again.
  const shownId = openedId === currentId ? openedId : null
  // The message belongs to the list it was sent to.
  if (wantedId && notice) setNotice(null)

  useEffect(() => {
    void requestPersistentStorage()
    void bootstrap().finally(() => setReady(true))
    // The sign-in service lands on "#/entrar…"; once in, that is just the list.
    if (location.hash.startsWith('#/entrar')) navigate({ name: 'collections' }, { replace: true })
  }, [bootstrap, navigate])

  useEffect(() => {
    if (
      !ready ||
      loadFailed ||
      !wantedId ||
      wantedId === shownId ||
      wantedId === openFailedId ||
      wantedId === leavingId
    ) {
      return
    }
    let current = true
    /** False also when the open collection could not be saved first: then it does exist. */
    const missing = async () => {
      const list = await listCollections().catch((e: unknown) => {
        console.error(e)
        return null
      })
      return list !== null && !list.some((c) => c.id === wantedId)
    }
    openCollection(wantedId)
      .then(async (found) => {
        if (!current) return
        if (!found) {
          if (await missing()) {
            if (!current) return
            navigate({ name: 'collections' }, { replace: true })
            setNotice('home.notFound')
            return
          }
          if (!current) return
          // The open work could not be saved (the banner says so): it stays where it is.
          navigate(shownId ? { name: 'editor', id: shownId } : { name: 'collections' }, {
            replace: true,
          })
          return
        }
        // True can also mean another open won the race: the address follows what is open.
        const openId = getEditorState().collection.id
        setOpenedId(openId)
        if (openId !== wantedId) navigate({ name: 'editor', id: openId }, { replace: true })
      })
      .catch((e: unknown) => {
        console.error(e)
        if (current) setOpenFailedId(wantedId)
      })
    return () => {
      current = false
    }
  }, [
    ready,
    loadFailed,
    wantedId,
    shownId,
    openFailedId,
    leavingId,
    openCollection,
    listCollections,
    navigate,
  ])

  /** Takes the editor off this collection, then shows the list; a failure without a message stays. */
  const leave = async (id: string, action: () => Promise<void>, failure?: MessageKey) => {
    setLeavingId(id)
    try {
      await action()
      navigate({ name: 'collections' })
    } catch (e) {
      console.error(e)
      if (failure) {
        navigate({ name: 'collections' })
        setNotice(failure)
      }
    } finally {
      setLeavingId(null)
    }
  }

  const retry = () => {
    // Hidden while it reads, or a retry would flash the screens behind.
    setReady(false)
    setOpenFailedId(null)
    void bootstrap().finally(() => setReady(true))
  }

  /** A collection just opened (or created) here becomes the route. */
  const showOpened = (id: string) => {
    setOpenedId(id)
    setOpenFailedId(null)
    navigate({ name: 'editor', id })
  }

  // On the list, a failed reading shows in the list itself, with its own retry.
  const failed = wantedId !== null && (loadFailed || wantedId === openFailedId)

  let screen = null
  if (ready && !failed) {
    if (!wantedId) {
      screen = (
        <HomeScreen
          tab={route.name === 'mouldings' || route.name === 'frames' ? route.name : 'collections'}
          folderId={route.name === 'frames' ? route.folderId : undefined}
          account={account}
          onSignOut={onSignOut}
          onOpened={showOpened}
          onOpen={(id) => navigate({ name: 'editor', id })}
          notice={notice ? t(notice) : null}
          onDismissNotice={dismissNotice}
        />
      )
    } else if (wantedId === shownId) {
      screen =
        route.name === 'share' ? (
          <SheetScreen
            onBack={() => navigate({ name: 'editor', id: wantedId }, { replace: true })}
          />
        ) : (
          <BuildScreen onLeave={(action, failure) => void leave(wantedId, action, failure)} />
        )
    }
  }

  return (
    <main className="app">
      {saveFailed && (
        <p className="banner" role="alert">
          {t('banner.saveFailed')}
        </p>
      )}
      {ready && failed && (
        <div className="empty-stage">
          <h1 role="alert">{t('load.failed')}</h1>
          <p>{t('load.safe')}</p>
          <button type="button" className="primary-button" onClick={retry}>
            {t('load.retry')}
          </button>
          <button
            type="button"
            className="load-others"
            onClick={() => {
              // Picking the same one again from the list tries to read it again.
              setOpenFailedId(null)
              navigate({ name: 'collections' })
            }}
          >
            {t('load.others')}
          </button>
        </div>
      )}
      {screen}
      {ready && <InstallHint />}
    </main>
  )
}
