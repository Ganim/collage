import { LayoutGrid, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ACCEPT } from '../../photos/import'
import { useEditor } from '../../state/editor'
import { t } from '../i18n'
import { PhotoGrid } from './PhotoGrid'
import { PhotoThumb } from './PhotoThumb'
import { photoUsage } from './photoUsage'

/** How far up a finger must go on the tray to open the grid. */
const SWIPE_UP_PX = 40

interface PhotoTrayProps {
  onUpload: (files: File[]) => void
  onPhotoTap: (photoId: string) => void
}

export function PhotoTray({ onUpload, onPhotoTap }: PhotoTrayProps) {
  const photoIds = useEditor((s) => s.collection.photoIds)
  const photos = useEditor((s) => s.photos)
  const frames = useEditor((s) => s.collection.frames)
  const deletePhoto = useEditor((s) => s.deletePhoto)
  const [gridOpen, setGridOpen] = useState(false)
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const empty = photoIds.length === 0

  const usage = useMemo(() => photoUsage(frames), [frames])

  return (
    <>
      <div
        className="tray"
        onPointerDown={(e) => {
          swipeStart.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const from = swipeStart.current
          swipeStart.current = null
          if (!from || empty) return
          const dx = e.clientX - from.x
          const dy = e.clientY - from.y
          if (dy < -SWIPE_UP_PX && Math.abs(dy) > Math.abs(dx) * 1.5) setGridOpen(true)
        }}
        onPointerCancel={() => {
          swipeStart.current = null
        }}
      >
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
              sizes={usage.get(id)}
              onTap={() => onPhotoTap(id)}
              onDelete={() => void deletePhoto(id)}
            />
          ) : null
        })}
        {!empty && (
          <button
            type="button"
            className="tray-all"
            aria-label={t('tray.all')}
            onClick={() => setGridOpen(true)}
          >
            <LayoutGrid size={22} />
          </button>
        )}
      </div>
      {gridOpen && (
        <PhotoGrid
          usage={usage}
          onPick={(id) => {
            setGridOpen(false)
            onPhotoTap(id)
          }}
          onClose={() => setGridOpen(false)}
        />
      )}
    </>
  )
}
