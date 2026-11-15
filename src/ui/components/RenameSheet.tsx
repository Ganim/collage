import { useState } from 'react'
import { t } from '../i18n'
import { BottomSheet } from './BottomSheet'

interface RenameSheetProps {
  title: string
  initial: string
  /** Gets the name without the spaces around it; never an empty one. */
  onSave: (name: string) => void
  onClose: () => void
}

export function RenameSheet({ title, initial, onSave, onClose }: RenameSheetProps) {
  const [name, setName] = useState(initial)
  const trimmed = name.trim()

  return (
    <BottomSheet title={title} onClose={onClose}>
      <form
        className="rename-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!trimmed) return
          onClose()
          onSave(trimmed)
        }}
      >
        <label className="text-field">
          {t('rename.label')}
          <input
            type="text"
            value={name}
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="sheet-buttons">
          <button type="button" className="secondary-button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary-button" disabled={!trimmed}>
            {t('rename.save')}
          </button>
        </div>
      </form>
    </BottomSheet>
  )
}
