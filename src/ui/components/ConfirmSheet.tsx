import { t } from '../i18n'
import { BottomSheet } from './BottomSheet'

interface ConfirmSheetProps {
  title: string
  body: string
  /** A second line under the body, for a circumstance worth knowing before going ahead. */
  note?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Asks before anything is lost; only the confirm button goes ahead. */
export function ConfirmSheet({
  title,
  body,
  note,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmSheetProps) {
  return (
    <BottomSheet title={title} onClose={onClose}>
      <p className="confirm-body">{body}</p>
      {note && <p className="confirm-body">{note}</p>}
      <div className="sheet-buttons">
        <button type="button" className="secondary-button" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className={danger ? 'primary-button danger-button' : 'primary-button'}
          onClick={() => {
            onClose()
            onConfirm()
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </BottomSheet>
  )
}
