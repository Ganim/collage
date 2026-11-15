import { EllipsisVertical, type LucideIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import { BottomSheet } from './BottomSheet'

export interface KebabItem {
  icon: LucideIcon
  label: string
  onClick: () => void
  danger?: boolean
}

interface KebabProps {
  /** Names the button and titles the sheet it opens. */
  label: string
  /** Each group is set apart from the next by a line. */
  items: KebabItem[][]
}

/** The ⋮ button: its options open in a bottom sheet, and choosing one closes it. */
export function Kebab({ label, items }: KebabProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="icon-button kebab-button"
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        <EllipsisVertical size={22} />
      </button>
      {open && (
        <BottomSheet title={label} onClose={() => setOpen(false)}>
          <ul className="menu-list">
            {items.map((group, g) => (
              <Fragment key={g}>
                {g > 0 && <li className="menu-separator" role="separator" />}
                {group.map(({ icon: Icon, label: itemLabel, onClick, danger }) => (
                  <li key={itemLabel}>
                    <button
                      type="button"
                      className={danger ? 'menu-row menu-row--danger' : 'menu-row'}
                      onClick={() => {
                        setOpen(false)
                        onClick()
                      }}
                    >
                      <Icon size={22} />
                      {itemLabel}
                    </button>
                  </li>
                ))}
              </Fragment>
            ))}
          </ul>
        </BottomSheet>
      )}
    </>
  )
}
