import { useId, useState, type FormEvent } from 'react'
import type { SavedSize, Size } from '../../core/types'
import { useEditor } from '../../state/editor'
import { parseCm, sizeListText } from '../build/sizeText'
import { BottomSheet } from '../components/BottomSheet'
import { Select } from '../components/Select'
import { t } from '../i18n'
import { DEFAULTS_ID, MINE_ID, groupSizes } from './folders'

interface SizeFormProps {
  /** The size to edit (its name and folder); without it, a new size is created. */
  editing?: SavedSize
  /** The folder picked at first for a new size; Meus tamanhos if absent or read-only. */
  folderId?: string
  onClose: () => void
  /**
   * In the editor: called with a new size once it is saved, to use it right away. The name may
   * then be left empty: the size is saved under its measures.
   */
  onSaved?: (size: Size, folderId: string) => void
}

/** Creates a size (name, width, height, folder) or edits one (name, folder). */
export function SizeForm({ editing, folderId, onClose, onSaved }: SizeFormProps) {
  const folders = useEditor((s) => s.folders)
  const saveSize = useEditor((s) => s.saveSize)
  const updateSize = useEditor((s) => s.updateSize)
  const choices = groupSizes(folders, []).filter((g) => g.id !== DEFAULTS_ID)
  const known = (id: string | undefined) => choices.some((g) => g.id === id)
  const initialFolder = editing ? editing.folderId : folderId

  const [name, setName] = useState(editing?.name ?? '')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [folder, setFolder] = useState(
    initialFolder && known(initialFolder) ? initialFolder : MINE_ID,
  )
  const [busy, setBusy] = useState(false)
  const folderFieldId = useId()
  const [failed, setFailed] = useState(false)

  const widthMm = parseCm(width)
  const heightMm = parseCm(height)
  const invalid =
    (width.trim() !== '' && widthMm === null) || (height.trim() !== '' && heightMm === null)
  const trimmed = name.trim()
  const nameOptional = onSaved !== undefined && !editing
  const ready =
    (trimmed !== '' || nameOptional) &&
    (editing !== undefined || (widthMm !== null && heightMm !== null))
  // Meus tamanhos is where a size without a folder lives.
  const target = folder === MINE_ID ? undefined : folder

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setFailed(false)
    try {
      if (editing) await updateSize(editing.id, { name: trimmed, folderId: target })
      else if (widthMm !== null && heightMm !== null) {
        const size = { widthMm, heightMm }
        await saveSize(trimmed || sizeListText(size), size, target)
        if (onSaved) {
          onSaved(size, folder)
          return
        }
      }
      onClose()
    } catch (err) {
      console.error(err)
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      title={editing ? t('sizeForm.editTitle') : t('sizeForm.newTitle')}
      onClose={onClose}
    >
      <form className="custom-size size-form" onSubmit={(e) => void submit(e)}>
        {editing && <p className="size-form-measure custom-size-wide">{sizeListText(editing)}</p>}
        <label className="custom-size-wide">
          {nameOptional ? t('sizeSheet.name') : t('sizeForm.name')}
          <input
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {!editing && (
          <>
            <label>
              {t('sizeSheet.width')}
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={width.trim() !== '' && widthMm === null}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </label>
            <label>
              {t('sizeSheet.height')}
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={height.trim() !== '' && heightMm === null}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </label>
            {invalid && (
              <p className="custom-size-error custom-size-wide" role="status">
                {t('sizeSheet.invalid')}
              </p>
            )}
          </>
        )}
        {/* Not wrapped: WebKit would add the options to the field's name. */}
        <div className="size-form-field custom-size-wide">
          <label id={`${folderFieldId}-label`} htmlFor={folderFieldId}>
            {t('sizeForm.folder')}
          </label>
          <Select
            id={folderFieldId}
            labelledBy={`${folderFieldId}-label`}
            value={folder}
            options={choices.map((g) => ({ value: g.id, label: g.name }))}
            onChange={setFolder}
          />
        </div>
        {failed && (
          <p className="custom-size-error custom-size-wide" role="status">
            {t('sizeForm.failed')}
          </p>
        )}
        <button type="submit" className="primary-button custom-size-wide" disabled={!ready || busy}>
          {onSaved ? t('sizeForm.saveAndUse') : t('sizeForm.save')}
        </button>
      </form>
    </BottomSheet>
  )
}
