import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { t } from '../i18n'

interface BottomSheetProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export function BottomSheet({ title, onClose, children }: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      // Otherwise the browser focuses, and rings, the close button as the sheet opens.
      dialog.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        // The content fills the dialog, so a click on the dialog itself is on the backdrop.
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="sheet-content">
        <div className="sheet-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t('sheet.close')}
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
