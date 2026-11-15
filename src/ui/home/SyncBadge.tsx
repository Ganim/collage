import { Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSyncStatus, type SyncStatus } from '../../sync/status'
import { syncIcon, syncSentence } from './syncText'

/** The fields the sentence reads: a change elsewhere (changeCount) renders nothing again. */
const sentenceFields = ({ state, error, lastSyncedAt, photos }: SyncStatus) => ({
  state,
  error,
  lastSyncedAt,
  photos,
})

/** "Sincronizado há 5 min" has to move on by itself while it is on screen. */
export function useSyncSentence(): string {
  const status = useSyncStatus(useShallow(sentenceFields))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return syncSentence(status, Math.max(now, status.lastSyncedAt ?? 0))
}

/** The cloud left of the avatar; its name is the status, and tapping it opens the account menu. */
export function SyncBadge({ onOpen }: { onOpen: () => void }) {
  const icon = useSyncStatus(syncIcon)
  const sentence = useSyncSentence()
  return (
    <button type="button" className="sync-badge" aria-label={sentence} onClick={onOpen}>
      {icon === 'synced' ? (
        <Cloud size={22} aria-hidden="true" />
      ) : icon === 'syncing' ? (
        <RefreshCw size={20} className="spinning" aria-hidden="true" />
      ) : (
        <CloudOff size={22} aria-hidden="true" />
      )}
    </button>
  )
}
