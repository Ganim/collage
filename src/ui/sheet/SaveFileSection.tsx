import { FileDown } from 'lucide-react'
import { useState } from 'react'
import { useEditor } from '../../state/editor'
import { t } from '../i18n'
import { deliverFile, safeFileName } from './deliver'

const COLLECTION_TYPE = 'application/octet-stream'

/** Saves the open collection as a .collage file, to open again later or on another device. */
export function SaveFileSection() {
  const name = useEditor((s) => s.collection.name)
  const exportActive = useEditor((s) => s.exportActive)
  const [building, setBuilding] = useState(false)
  // Built first and delivered on a second tap: iOS only shares right after a touch.
  const [bundle, setBundle] = useState<Blob | null>(null)
  const [failed, setFailed] = useState(false)

  const build = async () => {
    setBuilding(true)
    setFailed(false)
    try {
      setBundle(await exportActive())
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
      const result = await deliverFile(blob, safeFileName(name, 'collage'), COLLECTION_TYPE)
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
