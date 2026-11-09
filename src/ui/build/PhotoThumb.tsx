import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Photo } from '../../core/types'
import { t } from '../i18n'
import { usePhotoUrl } from '../usePhotoUrl'

/** Long enough to read and tap again, short enough that a stray tap cannot be confirmed later. */
const CONFIRM_MS = 4000

interface PhotoThumbProps {
  photo: Photo
  onTap: () => void
  onDelete: () => void
}

export function PhotoThumb({ photo, onTap, onDelete }: PhotoThumbProps) {
  const url = usePhotoUrl(photo.id, 'thumb')
  // There is no undo, and the photo may be in several finished frames.
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [confirming])

  return (
    <div className="tray-item">
      <button
        type="button"
        className="tray-photo"
        aria-label={t('tray.place', { name: photo.name })}
        onClick={onTap}
      >
        {url && <img src={url} alt="" draggable={false} />}
      </button>
      <button
        type="button"
        className={confirming ? 'tray-delete tray-delete--confirming' : 'tray-delete'}
        aria-label={t(confirming ? 'tray.deleteConfirm' : 'tray.delete', { name: photo.name })}
        onClick={() => (confirming ? onDelete() : setConfirming(true))}
      >
        <span>{confirming ? t('tray.deleteShort') : <Trash2 size={14} />}</span>
      </button>
    </div>
  )
}
