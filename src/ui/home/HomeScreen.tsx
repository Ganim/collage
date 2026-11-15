import type { Account } from '../account/account'
import { AccountHeader } from './AccountHeader'
import { CollectionsTab } from './CollectionsTab'
import { FramesTab } from './FramesTab'
import { MouldingsTab } from './MouldingsTab'
import { Tabs, panelId, tabId, type TabName } from './Tabs'

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
}

/** The account on top, the three sections below it, and the active one's content. */
export function HomeScreen({
  tab,
  folderId,
  account,
  onSignOut,
  onOpened,
  onOpen,
}: HomeScreenProps) {
  return (
    <div className="home">
      <AccountHeader account={account} onSignOut={onSignOut} />
      <Tabs active={tab} />
      <div className="home-panel" id={panelId} role="tabpanel" aria-labelledby={tabId(tab)}>
        {tab === 'collections' && <CollectionsTab onOpened={onOpened} onOpen={onOpen} />}
        {tab === 'mouldings' && <MouldingsTab />}
        {tab === 'frames' && <FramesTab folderId={folderId} />}
      </div>
    </div>
  )
}
