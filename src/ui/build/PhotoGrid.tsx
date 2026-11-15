import { Check, Frame as FrameIcon, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Photo } from '../../core/types'
import { useEditor } from '../../state/editor'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { t } from '../i18n'
import { useLongPress } from '../useLongPress'
import { usePhotoUrl } from '../usePhotoUrl'
import { SizeChip, UsedMark } from './PhotoThumb'
import { SizeSheet } from './SizeSheet'

interface PhotoGridProps {
  /** For each photo in a frame, the sizes of its frames. */
  usage: Map<string, string[]>
  onPick: (photoId: string) => void
  onClose: () => void
  /** Only to pick one photo: no selecting several. */
  pickOnly?: boolean
}

const selectedText = (count: number) =>
  count === 0
    ? t('photoGrid.selectedNone')
    : count === 1
      ? t('photoGrid.selectedOne')
      : t('photoGrid.selectedMany', { count })

/**
 * Every photo of the collection at once, marked when a frame already has it. Holding one (or
 * "Selecionar") starts picking several, to give each its own frame of one size, or delete them.
 */
export function PhotoGrid({ usage, onPick, onClose, pickOnly = false }: PhotoGridProps) {
  const photoIds = useEditor((s) => s.collection.photoIds)
  const photos = useEditor((s) => s.photos)
  const framesForPhotos = useEditor((s) => s.framesForPhotos)
  const deletePhotos = useEditor((s) => s.deletePhotos)
  const shown = photoIds.map((id) => photos[id]).filter((p): p is Photo => Boolean(p))
  const usedCount = shown.filter((p) => usage.has(p.id)).length

  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [sheet, setSheet] = useState<'size' | 'delete' | null>(null)
  const [failed, setFailed] = useState(false)

  const toggle = (id: string) =>
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  const startSelecting = (id?: string) => {
    setSelecting(true)
    if (id && !selected.includes(id)) setSelected((list) => [...list, id])
  }

  const stopSelecting = () => {
    setSelecting(false)
    setSelected([])
  }

  // In the order of the tray, whatever order they were picked in.
  const inOrder = () => shown.map((p) => p.id).filter((id) => selected.includes(id))

  return (
    <>
      <BottomSheet
        title={pickOnly ? t('photoPicker.title') : t('photoGrid.title')}
        onClose={onClose}
      >
        <p className="photo-grid-count">
          {t('photoGrid.count', { used: usedCount, total: shown.length })}
        </p>
        {pickOnly ? null : selecting ? (
          <div className="photo-grid-tools">
            <button
              type="button"
              className="text-button"
              onClick={() => setSelected(shown.filter((p) => !usage.has(p.id)).map((p) => p.id))}
            >
              {t('photoGrid.selectUnused')}
            </button>
            {selected.length > 0 && (
              <button type="button" className="text-button" onClick={() => setSelected([])}>
                {t('photoGrid.clear')}
              </button>
            )}
            <button type="button" className="text-button" onClick={stopSelecting}>
              {t('photoGrid.cancel')}
            </button>
          </div>
        ) : (
          <div className="photo-grid-tools">
            <p className="photo-grid-hint">{t('photoGrid.hint')}</p>
            <button type="button" className="text-button" onClick={() => startSelecting()}>
              {t('photoGrid.select')}
            </button>
          </div>
        )}
        <ul className="photo-grid">
          {shown.map((photo) => (
            <li key={photo.id}>
              <GridPhoto
                photo={photo}
                sizes={usage.get(photo.id) ?? []}
                selecting={selecting}
                selected={selected.includes(photo.id)}
                onTap={() => (selecting ? toggle(photo.id) : onPick(photo.id))}
                onHold={pickOnly ? undefined : () => startSelecting(photo.id)}
              />
            </li>
          ))}
        </ul>
        {selecting && (
          <div
            className="photo-grid-actions"
            role="group"
            aria-label={selectedText(selected.length)}
          >
            <p role="status">{selectedText(selected.length)}</p>
            {failed && <p className="custom-size-error">{t('photoGrid.deleteFailed')}</p>}
            <div className="photo-grid-buttons">
              <button
                type="button"
                className="secondary-button photo-grid-delete"
                disabled={selected.length === 0}
                onClick={() => setSheet('delete')}
              >
                <Trash2 size={18} aria-hidden="true" />
                {t('photoGrid.delete')}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={selected.length === 0}
                onClick={() => setSheet('size')}
              >
                <FrameIcon size={18} aria-hidden="true" />
                {t('photoGrid.toFrames')}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
      {sheet === 'size' && (
        <SizeSheet
          mode="pick"
          onClose={() => setSheet(null)}
          onPick={(size) => {
            framesForPhotos(size, inOrder())
            onClose()
          }}
        />
      )}
      {sheet === 'delete' && (
        <ConfirmSheet
          title={
            selected.length === 1
              ? t('photoGrid.deleteTitleOne')
              : t('photoGrid.deleteTitleMany', { count: selected.length })
          }
          body={t('photoGrid.deleteBody')}
          confirmLabel={t('photoGrid.deleteConfirm')}
          danger
          onConfirm={() => {
            const ids = inOrder()
            setFailed(false)
            deletePhotos(ids)
              .then(stopSelecting)
              .catch((e: unknown) => {
                console.error(e)
                setFailed(true)
              })
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  )
}

interface GridPhotoProps {
  photo: Photo
  sizes: string[]
  selecting: boolean
  selected: boolean
  onTap: () => void
  onHold?: () => void
}

function GridPhoto({ photo, sizes, selecting, selected, onTap, onHold }: GridPhotoProps) {
  const url = usePhotoUrl(photo.id, 'thumb')
  const press = useLongPress(() => onHold?.())
  const used = sizes.length > 0
  const className = selected ? 'photo-grid-item photo-grid-item--selected' : 'photo-grid-item'
  return (
    <button
      type="button"
      className={className}
      aria-label={
        selecting
          ? t('photoGrid.toggle', { name: photo.name })
          : t(used ? 'tray.placeUsed' : 'tray.place', { name: photo.name })
      }
      aria-pressed={selecting ? selected : undefined}
      onClick={onTap}
      // Always on: the click that ends a hold must not unselect the photo it selected.
      {...(onHold ? press : {})}
    >
      {url && <img src={url} alt="" draggable={false} />}
      {used && <UsedMark />}
      {used && <SizeChip sizes={sizes} />}
      {selecting && (
        <span className="photo-select" aria-hidden="true">
          {selected && <Check size={16} strokeWidth={3} />}
        </span>
      )}
    </button>
  )
}
