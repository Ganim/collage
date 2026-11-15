import { X } from 'lucide-react'
import { useEffect } from 'react'
import type { Account } from '../account/account'
import { t } from '../i18n'
import { AccountHeader } from './AccountHeader'
import { CollectionsTab } from './CollectionsTab'
import { FramesTab } from './FramesTab'
import { MouldingsTab } from './MouldingsTab'
import { Tabs, panelId, tabId, type TabName } from './Tabs'

const NOTICE_MS = 8000

interface HomeScreenProps {
  tab: TabName
  /** On the Frames tab, the folder the route names. */
  folderId?: string
  account: Account
  onSignOut: () => void
  /** Shows in the editor a collection already open there. */
  onOpened: (id: string) => void
  /** Shows a collection in the editor, which opens it. */
  onOpen: (id: string) => void
  /** Why the app came back here, if it says so (a link to a collection that is gone). */
  notice?: string | null
  onDismissNotice?: () => void
}

/** The account on top, the three sections below it, and the active one's content. */
export function HomeScreen({
  tab,
  folderId,
  account,
  onSignOut,
  onOpened,
  onOpen,
  notice,
  onDismissNotice,
}: HomeScreenProps) {
  useEffect(() => {
    if (!notice || !onDismissNotice) return
    const timer = setTimeout(onDismissNotice, NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice, onDismissNotice])

  return (
    <div className="home">
      <AccountHeader account={account} onSignOut={onSignOut} />
      <Tabs active={tab} />
      {notice && (
        <div className="home-notice glass" role="status">
          <p>{notice}</p>
          <button
            type="button"
            className="icon-button"
            aria-label={t('home.dismissNotice')}
            onClick={onDismissNotice}
          >
            <X size={20} />
          </button>
        </div>
      )}
      <div className="home-panel" id={panelId} role="tabpanel" aria-labelledby={tabId(tab)}>
        {tab === 'collections' && <CollectionsTab onOpened={onOpened} onOpen={onOpen} />}
        {tab === 'mouldings' && <MouldingsTab />}
        {tab === 'frames' && <FramesTab folderId={folderId} />}
      </div>
    </div>
  )
}
