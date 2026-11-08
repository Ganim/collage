import { useEffect, useState } from 'react'
import { useEditor } from '../state/editor'
import { BuildScreen } from './build/BuildScreen'

export function App() {
  const bootstrap = useEditor((s) => s.bootstrap)
  // Until the saved collection is in, the empty state would flash on every visit.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void bootstrap().finally(() => setReady(true))
  }, [bootstrap])

  return <main className="app">{ready && <BuildScreen />}</main>
}
