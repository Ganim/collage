import { useEffect, useState } from 'react'
import { getEditorState, useEditor } from '../state/editor'
import { requestPersistentStorage } from '../storage/persist'
import { useAccount } from './account/useAccount'
import { BuildScreen } from './build/BuildScreen'
import { t } from './i18n'
import { EmptyCollectionsIllustration } from './illustrations'
import { InstallHint } from './install/InstallHint'
import { CollectionsScreen } from './library/CollectionsScreen'
import { useRoute, type Route } from './router'
import { SheetScreen } from './sheet/SheetScreen'
import { StartScreen } from './start/StartScreen'

export function App() {
  const { status } = useAccount()

  if (status === 'checking') return <main className="app" aria-busy="true" />
  if (status === 'out') {
    return (
      <main className="app">
        <StartScreen />
        <InstallHint />
      </main>
    )
  }
  return <Workspace />
}

const collectionId = (r: Route) => (r.name === 'editor' || r.name === 'share' ? r.id : null)

function Workspace() {
  const bootstrap = useEditor((s) => s.bootstrap)
  const openCollection = useEditor((s) => s.openCollection)
  const exitEdit = useEditor((s) => s.exitEdit)
  const saveStatus = useEditor((s) => s.saveStatus)
  const loadFailed = useEditor((s) => s.loadFailed)
  const [route, navigate] = useRoute()
  // Until sizes and folders are in, the screens would flash empty on every visit.
  const [ready, setReady] = useState(false)
  /** While the list is open from the failure screen: the id that was open before it. */
  const [recovering, setRecovering] = useState<string | null>(null)
  /** The collection the route names, once it is the one open in the editor. */
  const [openedId, setOpenedId] = useState<string | null>(null)
  /** A collection the route names whose reading failed (not a missing one). */
  const [openFailedId, setOpenFailedId] = useState<string | null>(null)
  // A retry passes through 'saving'; the warning stays up until a save really works.
  const [saveFailed, setSaveFailed] = useState(false)
  if (saveStatus === 'full' && !saveFailed) setSaveFailed(true)
  if (saveStatus === 'saved' && saveFailed) setSaveFailed(false)

  const wantedId = collectionId(route)

  useEffect(() => {
    void requestPersistentStorage()
    void bootstrap().finally(() => setReady(true))
    // The sign-in service lands on "#/entrar…"; once in, that is just the list.
    if (location.hash.startsWith('#/entrar')) navigate({ name: 'collections' }, { replace: true })
  }, [bootstrap, navigate])

  useEffect(() => {
    if (!ready || loadFailed || !wantedId || wantedId === openedId || wantedId === openFailedId) {
      return
    }
    let current = true
    openCollection(wantedId)
      .then((found) => {
        if (!current) return
        if (found) setOpenedId(wantedId)
        else navigate({ name: 'collections' }, { replace: true })
      })
      .catch((e: unknown) => {
        console.error(e)
        if (current) setOpenFailedId(wantedId)
      })
    return () => {
      current = false
    }
  }, [ready, loadFailed, wantedId, openedId, openFailedId, openCollection, navigate])

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

  const failed = loadFailed || (wantedId !== null && wantedId === openFailedId)

  let screen = null
  if (ready && !failed) {
    if (!wantedId) {
      screen = <CollectionsPlaceholder onCreated={showOpened} />
    } else if (wantedId === openedId) {
      screen =
        route.name === 'share' ? (
          <SheetScreen
            onBack={() => navigate({ name: 'editor', id: wantedId }, { replace: true })}
          />
        ) : (
          <BuildScreen
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
            onClick={() => setRecovering(getEditorState().collection.id)}
          >
            {t('load.others')}
          </button>
          {recovering !== null && (
            <CollectionsScreen
              recovering
              onClose={() => {
                setRecovering(null)
                // Closing the list without picking anything leaves the failure on screen.
                const { collection } = getEditorState()
                if (collection.id !== recovering) showOpened(collection.id)
              }}
            />
          )}
        </div>
      )}
      {screen}
      {ready && <InstallHint />}
    </main>
  )
}

/** Stands in for the collections screen until it is built; its button keeps the same name. */
function CollectionsPlaceholder({ onCreated }: { onCreated: (id: string) => void }) {
  const newCollection = useEditor((s) => s.newCollection)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const create = async () => {
    setBusy(true)
    setFailed(false)
    try {
      onCreated(await newCollection())
    } catch (e) {
      console.error(e)
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <div className="empty-stage collections-placeholder">
      <EmptyCollectionsIllustration />
      <h1>{t('library.title')}</h1>
      {failed && <p role="alert">{t('library.newFailed')}</p>}
      <button
        type="button"
        className="primary-button"
        disabled={busy}
        onClick={() => void create()}
      >
        {t('library.new')}
      </button>
    </div>
  )
}
