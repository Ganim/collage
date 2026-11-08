import type { Photo } from '../../core/types'
import { t } from '../i18n'
import { usePhotoUrl } from '../usePhotoUrl'

export function PhotoThumb({ photo, onTap }: { photo: Photo; onTap: () => void }) {
  const url = usePhotoUrl(photo.id, 'thumb')
  return (
    <button
      type="button"
      className="tray-photo"
      aria-label={t('tray.place', { name: photo.name })}
      onClick={onTap}
    >
      {url && <img src={url} alt="" draggable={false} />}
    </button>
  )
}
