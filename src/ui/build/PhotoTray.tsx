import { Plus } from 'lucide-react'
import { ACCEPT } from '../../photos/import'
import { useEditor } from '../../state/editor'
import { t } from '../i18n'
import { PhotoThumb } from './PhotoThumb'

interface PhotoTrayProps {
  onUpload: (files: File[]) => void
  onPhotoTap: (photoId: string) => void
}

export function PhotoTray({ onUpload, onPhotoTap }: PhotoTrayProps) {
  const photoIds = useEditor((s) => s.collection.photoIds)
  const photos = useEditor((s) => s.photos)
  const deletePhoto = useEditor((s) => s.deletePhoto)
  const empty = photoIds.length === 0

  return (
    <div className="tray">
      <label className={empty ? 'tray-add tray-add--empty' : 'tray-add'}>
        <input
          type="file"
          accept={ACCEPT}
          multiple
          aria-label={t('tray.add')}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            // Lets the same file be chosen again.
            e.target.value = ''
            if (files.length > 0) onUpload(files)
          }}
        />
        <Plus size={empty ? 22 : 26} />
        {empty && <span>{t('tray.add')}</span>}
      </label>
      {photoIds.map((id) => {
        const photo = photos[id]
        return photo ? (
          <PhotoThumb
            key={id}
            photo={photo}
            onTap={() => onPhotoTap(id)}
            onDelete={() => void deletePhoto(id)}
          />
        ) : null
      })}
    </div>
  )
}
