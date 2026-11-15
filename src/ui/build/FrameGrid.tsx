import { Check, Copy, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Frame, Size } from '../../core/types'
import { useEditor } from '../../state/editor'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { t } from '../i18n'
import { useLongPress } from '../useLongPress'
import { FrameView } from './FrameView'
import { PhotoGrid } from './PhotoGrid'
import { photoUsage } from './photoUsage'
import { QuantitySheet } from './QuantitySheet'
import { SizeSheet } from './SizeSheet'
import { sizeShortText } from './sizeText'

interface FrameGridProps {
  onClose: () => void
}

const selectedText = (count: number) =>
  count === 0
    ? t('frameGrid.selectedNone')
    : count === 1
      ? t('frameGrid.selectedOne')
      : t('frameGrid.selectedMany', { count })

type Sheet =
  | { kind: 'size' }
  | { kind: 'quantity'; size: Size }
  | { kind: 'remove' }
  | { kind: 'photo'; frameId: string }

/**
 * Every frame of the collection at once: go to one, put a photo in one, add several of a
 * size, or hold one (or "Selecionar") to duplicate or remove several.
 */
export function FrameGrid({ onClose }: FrameGridProps) {
  const frames = useEditor((s) => s.collection.frames)
  const photoCount = useEditor((s) => s.collection.photoIds.length)
  const activeId = useEditor((s) => s.activeFrameId)
  const setActive = useEditor((s) => s.setActive)
  const tapPhoto = useEditor((s) => s.tapPhoto)
  const addFrames = useEditor((s) => s.addFrames)
  const duplicateFrames = useEditor((s) => s.duplicateFrames)
  const removeFrames = useEditor((s) => s.removeFrames)
  const usage = useMemo(() => photoUsage(frames), [frames])

  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [sheet, setSheet] = useState<Sheet | null>(null)

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

  const close = () => setSheet(null)

  return (
    <>
      <BottomSheet title={t('frameGrid.title')} onClose={onClose}>
        <div className="photo-grid-tools">
          <p className="photo-grid-count">
            {frames.length === 1
              ? t('frameGrid.countOne')
              : t('frameGrid.countMany', { count: frames.length })}
          </p>
          {frames.length > 0 &&
            (selecting ? (
              <button type="button" className="text-button" onClick={stopSelecting}>
                {t('photoGrid.cancel')}
              </button>
            ) : (
              <button type="button" className="text-button" onClick={() => startSelecting()}>
                {t('photoGrid.select')}
              </button>
            ))}
        </div>
        {!selecting && frames.length > 0 && (
          <p className="photo-grid-hint frame-grid-hint">{t('frameGrid.hint')}</p>
        )}
        <ul className="frame-grid">
          {frames.map((frame, i) => (
            <FrameTile
              key={frame.id}
              frame={frame}
              position={i + 1}
              active={frame.id === activeId}
              selecting={selecting}
              selected={selected.includes(frame.id)}
              canAddPhoto={photoCount > 0}
              onTap={() => {
                if (selecting) {
                  toggle(frame.id)
                  return
                }
                setActive(frame.id)
                onClose()
              }}
              onHold={() => startSelecting(frame.id)}
              onAddPhoto={() => setSheet({ kind: 'photo', frameId: frame.id })}
            />
          ))}
          {!selecting && (
            <li>
              <button
                type="button"
                className="frame-tile-new"
                onClick={() => setSheet({ kind: 'size' })}
              >
                <Plus size={24} strokeWidth={2.5} aria-hidden="true" />
                {t('frameGrid.add')}
              </button>
            </li>
          )}
        </ul>
        {selecting && (
          <div
            className="photo-grid-actions"
            role="group"
            aria-label={selectedText(selected.length)}
          >
            <p role="status">{selectedText(selected.length)}</p>
            <div className="photo-grid-buttons">
              <button
                type="button"
                className="secondary-button photo-grid-delete"
                disabled={selected.length === 0}
                onClick={() => setSheet({ kind: 'remove' })}
              >
                <Trash2 size={18} aria-hidden="true" />
                {t('frameGrid.remove')}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={selected.length === 0}
                onClick={() => {
                  duplicateFrames(selected)
                  stopSelecting()
                }}
              >
                <Copy size={18} aria-hidden="true" />
                {t('frameGrid.duplicate')}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
      {sheet?.kind === 'size' && (
        <SizeSheet
          mode="pick"
          onClose={close}
          onPick={(size) => setSheet({ kind: 'quantity', size })}
        />
      )}
      {sheet?.kind === 'quantity' && (
        <QuantitySheet
          size={sheet.size}
          onClose={close}
          onConfirm={(count) => addFrames(sheet.size, count)}
        />
      )}
      {sheet?.kind === 'remove' && (
        <ConfirmSheet
          title={
            selected.length === 1
              ? t('frameGrid.removeTitleOne')
              : t('frameGrid.removeTitleMany', { count: selected.length })
          }
          body={t('frameGrid.removeBody')}
          confirmLabel={t('frameGrid.remove')}
          danger
          onConfirm={() => {
            removeFrames(selected)
            stopSelecting()
          }}
          onClose={close}
        />
      )}
      {sheet?.kind === 'photo' && (
        <PhotoGrid
          pickOnly
          usage={usage}
          onClose={close}
          onPick={(photoId) => {
            setActive(sheet.frameId)
            tapPhoto(photoId)
            onClose()
          }}
        />
      )}
    </>
  )
}

interface FrameTileProps {
  frame: Frame
  position: number
  active: boolean
  selecting: boolean
  selected: boolean
  canAddPhoto: boolean
  onTap: () => void
  onHold: () => void
  onAddPhoto: () => void
}

function FrameTile({
  frame,
  position,
  active,
  selecting,
  selected,
  canAddPhoto,
  onTap,
  onHold,
  onAddPhoto,
}: FrameTileProps) {
  const press = useLongPress(onHold)
  const classes = ['frame-tile']
  if (active) classes.push('frame-tile--active')
  if (selected) classes.push('frame-tile--selected')
  return (
    <li className={classes.join(' ')}>
      <button
        type="button"
        className="frame-tile-open"
        aria-label={
          selecting ? t('frameGrid.toggle', { position }) : t('frameGrid.open', { position })
        }
        aria-pressed={selecting ? selected : undefined}
        aria-current={!selecting && active ? 'true' : undefined}
        onClick={onTap}
        {...press}
      >
        <span className="frame-tile-preview">
          <FrameView frame={frame} interactive={false} />
        </span>
        <span className="frame-tile-number" aria-hidden="true">
          {position}
        </span>
        <span className="photo-size" aria-hidden="true">
          {sizeShortText(frame)}
        </span>
        {selecting && (
          <span className="photo-select" aria-hidden="true">
            {selected && <Check size={16} strokeWidth={3} />}
          </span>
        )}
      </button>
      {!selecting && canAddPhoto && (
        <button
          type="button"
          className="frame-tile-photo"
          aria-label={t('frameGrid.addPhoto', { position })}
          onClick={onAddPhoto}
        >
          <ImagePlus size={18} />
        </button>
      )}
    </li>
  )
}
