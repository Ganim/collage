import { useEffect, useState } from 'react'
import { getEditorState, useEditor } from '../state/editor'
import { requestPersistentStorage } from '../storage/persist'
import type { Account } from './account/account'
import { useAccount } from './account/useAccount'
import { BuildScreen } from './build/BuildScreen'
import { HomeScreen } from './home/HomeScreen'
import { t } from './i18n'
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
  const exitEdit = useEditor((s) => s.exitEdit)
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
  const [saveFailed, setSaveFailed] = useState(false)
  if (saveStatus === 'full' && !saveFailed) setSaveFailed(true)
  if (saveStatus === 'saved' && saveFailed) setSaveFailed(false)

  const wantedId = collectionId(route)
  // Deleted from the list, or another one opened since: it has to be opened again.
  const shownId = openedId === currentId ? openedId : null

  useEffect(() => {
    void requestPersistentStorage()
    void bootstrap().finally(() => setReady(true))
    // The sign-in service lands on "#/entrar…"; once in, that is just the list.
    if (location.hash.startsWith('#/entrar')) navigate({ name: 'collections' }, { replace: true })
  }, [bootstrap, navigate])

  useEffect(() => {
    if (!ready || loadFailed || !wantedId || wantedId === shownId || wantedId === openFailedId) {
      return
    }
    let current = true
    openCollection(wantedId)
      .then((found) => {
        if (!current) return
        if (!found) {
          navigate({ name: 'collections' }, { replace: true })
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
  }, [ready, loadFailed, wantedId, shownId, openFailedId, openCollection, navigate])

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
          account={account}
          onSignOut={onSignOut}
          onOpened={showOpened}
          onOpen={(id) => navigate({ name: 'editor', id })}
        />
      )
    } else if (wantedId === shownId) {
      screen =
        route.name === 'share' ? (
          <SheetScreen
            onBack={() => navigate({ name: 'editor', id: wantedId }, { replace: true })}
          />
        ) : (
          <BuildScreen
            onCollections={() => navigate({ name: 'collections' })}
            onDownload={() => {
              exitEdit()
              navigate({ name: 'share', id: wantedId })
            }}
          />
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
