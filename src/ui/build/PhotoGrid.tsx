import type { Photo } from '../../core/types'
import { useEditor } from '../../state/editor'
import { BottomSheet } from '../components/BottomSheet'
import { t } from '../i18n'
import { usePhotoUrl } from '../usePhotoUrl'
import { UsedMark } from './PhotoThumb'

interface PhotoGridProps {
  /** Photos already in at least one frame. */
  used: Set<string>
  onPick: (photoId: string) => void
  onClose: () => void
}

/** Every photo of the collection at once, marked when a frame already has it. */
export function PhotoGrid({ used, onPick, onClose }: PhotoGridProps) {
  const photoIds = useEditor((s) => s.collection.photoIds)
  const photos = useEditor((s) => s.photos)
  const shown = photoIds.map((id) => photos[id]).filter((p): p is Photo => Boolean(p))
  const usedCount = shown.filter((p) => used.has(p.id)).length

  return (
    <BottomSheet title={t('photoGrid.title')} onClose={onClose}>
      <p className="photo-grid-count">
        {t('photoGrid.count', { used: usedCount, total: shown.length })}
      </p>
      <p className="photo-grid-hint">{t('photoGrid.hint')}</p>
      <ul className="photo-grid">
        {shown.map((photo) => (
          <li key={photo.id}>
            <GridPhoto photo={photo} used={used.has(photo.id)} onPick={() => onPick(photo.id)} />
          </li>
        ))}
      </ul>
    </BottomSheet>
  )
}

function GridPhoto({ photo, used, onPick }: { photo: Photo; used: boolean; onPick: () => void }) {
  const url = usePhotoUrl(photo.id, 'thumb')
  return (
    <button
      type="button"
      className="photo-grid-item"
      aria-label={t(used ? 'tray.placeUsed' : 'tray.place', { name: photo.name })}
      onClick={onPick}
    >
      {url && <img src={url} alt="" draggable={false} />}
      {used && <UsedMark />}
    </button>
  )
}
