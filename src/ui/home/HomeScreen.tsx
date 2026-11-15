import type { Account } from '../account/account'
import { AccountHeader } from './AccountHeader'
import { CollectionsTab } from './CollectionsTab'
import { MouldingsTab } from './MouldingsTab'
import { Tabs, panelId, tabId, type TabName } from './Tabs'

interface HomeScreenProps {
  tab: TabName
  account: Account
  onSignOut: () => void
  /** Shows in the editor a collection already open there. */
  onOpened: (id: string) => void
  /** Shows a collection in the editor, which opens it. */
  onOpen: (id: string) => void
}

/** The account on top, the three sections below it, and the active one's content. */
export function HomeScreen({ tab, account, onSignOut, onOpened, onOpen }: HomeScreenProps) {
  return (
    <div className="home">
      <AccountHeader account={account} onSignOut={onSignOut} />
      <Tabs active={tab} />
      <div className="home-panel" id={panelId} role="tabpanel" aria-labelledby={tabId(tab)}>
        {tab === 'collections' && <CollectionsTab onOpened={onOpened} onOpen={onOpen} />}
        {tab === 'mouldings' && <MouldingsTab />}
        {/* Sizes and their folders come here next. */}
        {tab === 'frames' && <div className="home-placeholder glass" />}
      </div>
    </div>
  )
}
