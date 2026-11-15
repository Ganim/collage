import { t, type MessageKey } from '../i18n'
import { routeHash } from '../router'

export type TabName = 'collections' | 'mouldings' | 'frames'

const TABS: { name: TabName; label: MessageKey }[] = [
  { name: 'collections', label: 'tabs.collections' },
  { name: 'mouldings', label: 'tabs.mouldings' },
  { name: 'frames', label: 'tabs.frames' },
]

export const tabId = (name: TabName) => `tab-${name}`
export const panelId = 'home-panel'

/** The three sections of the home, each one a route. */
export function Tabs({ active }: { active: TabName }) {
  return (
    <nav className="tabs glass" role="tablist" aria-label={t('tabs.label')}>
      {TABS.map(({ name, label }) => (
        <a
          key={name}
          id={tabId(name)}
          role="tab"
          className="tab"
          href={routeHash({ name })}
          aria-selected={name === active}
          aria-controls={panelId}
        >
          {t(label)}
        </a>
      ))}
    </nav>
  )
}
