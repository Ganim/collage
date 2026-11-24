import { FileDown } from 'lucide-react'
import { useState } from 'react'
import type { Collection } from '../../core/types'
import { getEditorState, useEditor } from '../../state/editor'
import { t } from '../i18n'
import { deliverFile, prefersShareSheet, safeFileName } from './deliver'

const COLLECTION_TYPE = 'application/octet-stream'

/** Same content; a save only stamps a new updatedAt on a copy, so that is left out. */
const sameContent = (a: Collection, b: Collection) =>
  a.id === b.id &&
  a.name === b.name &&
  a.frames === b.frames &&
  a.photoIds === b.photoIds &&
  a.paper === b.paper

/** Saves the open collection as a .collage file, to open again later or on another device. */
export function SaveFileSection() {
  const collection = useEditor((s) => s.collection)
  const exportActive = useEditor((s) => s.exportActive)
  const [building, setBuilding] = useState(false)
  // Built first and delivered on a second tap: iOS only shares right after a touch.
  const [built, setBundle] = useState<{ blob: Blob; of: Collection } | null>(null)
  const [failed, setFailed] = useState(false)
  // A file built before any change (the paper, a photo that landed) is never handed out.
  const bundle = built && sameContent(built.of, collection) ? built.blob : null

  const build = async () => {
    setBuilding(true)
    setFailed(false)
    try {
      const of = getEditorState().collection
      const blob = await exportActive()
      setBundle({ blob, of })
    } catch (e) {
      console.error(e)
      setFailed(true)
    } finally {
      setBuilding(false)
    }
  }

  const deliver = async (blob: Blob) => {
    setFailed(false)
    try {
      const result = await deliverFile(
        blob,
        safeFileName(collection.name, 'collage'),
        COLLECTION_TYPE,
        prefersShareSheet() ? 'share' : 'download',
      )
      // A file that went out stands for the collection as it was: the next one is built again.
      if (result !== 'cancelled') setBundle(null)
    } catch (e) {
      console.error(e)
      setFailed(true)
    }
  }

  return (
    <section className="save-file">
      <p className="save-file-hint">{t('saveFile.hint')}</p>
      {bundle ? (
        <button
          type="button"
          className="secondary-button save-file-button"
          onClick={() => void deliver(bundle)}
        >
          <FileDown size={20} aria-hidden="true" />
          {t('saveFile.deliver')}
        </button>
      ) : (
        <button
          type="button"
          className="secondary-button save-file-button"
          disabled={building}
          onClick={() => void build()}
        >
          <FileDown size={20} aria-hidden="true" />
          {building ? t('saveFile.building') : t('saveFile.save')}
        </button>
      )}
      {failed && (
        <p className="print-warning print-warning--error" role="alert">
          {t('saveFile.failed')}
        </p>
      )}
    </section>
  )
}
