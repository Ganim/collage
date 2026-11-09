import { useEffect, useState } from 'react'
import { useEditor } from '../state/editor'
import { BuildScreen } from './build/BuildScreen'
import { t } from './i18n'
import { SheetScreen } from './sheet/SheetScreen'

export function App() {
  const bootstrap = useEditor((s) => s.bootstrap)
  const exitEdit = useEditor((s) => s.exitEdit)
  const saveStatus = useEditor((s) => s.saveStatus)
  // Until the saved collection is in, the empty state would flash on every visit.
  const [ready, setReady] = useState(false)
  const [screen, setScreen] = useState<'build' | 'sheet'>('build')
  // A retry passes through 'saving'; the warning stays up until a save really works.
  const [saveFailed, setSaveFailed] = useState(false)
  if (saveStatus === 'full' && !saveFailed) setSaveFailed(true)
  if (saveStatus === 'saved' && saveFailed) setSaveFailed(false)

  useEffect(() => {
    void bootstrap().finally(() => setReady(true))
  }, [bootstrap])

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
      {ready &&
        (screen === 'build' ? (
          <BuildScreen onDownload={openSheet} />
        ) : (
          <SheetScreen onBack={() => setScreen('build')} />
        ))}
    </main>
  )
}
