import { EllipsisVertical, type LucideIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import { BottomSheet } from './BottomSheet'

export interface KebabItem {
  icon: LucideIcon
  label: string
  onClick: () => void
  danger?: boolean
  /** Shown but not usable, e.g. while another action runs. */
  disabled?: boolean
}

interface KebabProps {
  /** Names the button and titles the sheet it opens. */
  label: string
  /** Each group is set apart from the next by a line. */
  items: KebabItem[][]
  /** Every option is off, and so is the button, while an action runs. */
  disabled?: boolean
}

/** The ⋮ button: its options open in a bottom sheet, and choosing one closes it. */
export function Kebab({ label, items, disabled = false }: KebabProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="icon-button kebab-button"
        aria-label={label}
        disabled={disabled}
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
                {group.map(({ icon: Icon, label: itemLabel, onClick, danger, disabled: off }) => (
                  <li key={itemLabel}>
                    <button
                      type="button"
                      className={danger ? 'menu-row menu-row--danger' : 'menu-row'}
                      disabled={disabled || off}
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
