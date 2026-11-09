import { useEffect, useState } from 'react'
import { useEditor } from '../state/editor'
import { requestPersistentStorage } from '../storage/persist'
import { BuildScreen } from './build/BuildScreen'
import { t } from './i18n'
import { InstallHint } from './install/InstallHint'
import { CollectionsScreen } from './library/CollectionsScreen'
import { SheetScreen } from './sheet/SheetScreen'

export function App() {
  const bootstrap = useEditor((s) => s.bootstrap)
  const exitEdit = useEditor((s) => s.exitEdit)
  const saveStatus = useEditor((s) => s.saveStatus)
  const loadFailed = useEditor((s) => s.loadFailed)
  // Until the saved collection is in, the empty state would flash on every visit.
  const [ready, setReady] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [screen, setScreen] = useState<'build' | 'sheet'>('build')
  // A retry passes through 'saving'; the warning stays up until a save really works.
  const [saveFailed, setSaveFailed] = useState(false)
  if (saveStatus === 'full' && !saveFailed) setSaveFailed(true)
  if (saveStatus === 'saved' && saveFailed) setSaveFailed(false)

  useEffect(() => {
    void requestPersistentStorage()
    void bootstrap().finally(() => setReady(true))
  }, [bootstrap])

  const retry = () => {
    // Hidden while it reads, or a retry would flash the empty start screen.
    setReady(false)
    void bootstrap().finally(() => setReady(true))
  }

  const openSheet = () => {
    exitEdit()
    setScreen('sheet')
  }

  return (
    <main className="app">
      {saveFailed && (
        <p className="banner" role="alert">
          {t('banner.saveFailed')}
        </p>
      )}
      {ready && loadFailed && (
        <div className="empty-stage">
          <h1 role="alert">{t('load.failed')}</h1>
          <p>{t('load.safe')}</p>
          <button type="button" className="primary-button" onClick={retry}>
            {t('load.retry')}
          </button>
          <button type="button" className="load-others" onClick={() => setRecovering(true)}>
            {t('load.others')}
          </button>
          {recovering && <CollectionsScreen recovering onClose={() => setRecovering(false)} />}
        </div>
      )}
      {ready &&
        !loadFailed &&
        (screen === 'build' ? (
          <BuildScreen onDownload={openSheet} />
        ) : (
          <SheetScreen onBack={() => setScreen('build')} />
        ))}
      {ready && <InstallHint />}
    </main>
  )
}
