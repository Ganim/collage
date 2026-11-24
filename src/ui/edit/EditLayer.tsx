import { useRef, type CSSProperties } from 'react'
import { coversFrame } from '../../core/transform'
import type { Frame, Layer } from '../../core/types'
import { useEditor } from '../../state/editor'
import { layerPlacement } from '../build/LayerImage'
import { t } from '../i18n'
import { useLayerGestures } from './useLayerGestures'

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const

/** Sits over the frame while it is edited: takes the touches and draws the selection. */
export function EditLayer({ frame, selected }: { frame: Frame; selected: Layer }) {
  const photo = useEditor((s) => s.photos[selected.photoId])
  const rootRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const { bindSurface, bindHandle, guides } = useLayerGestures({
    root: rootRef,
    surface: surfaceRef,
    frame,
    selected,
  })
  const isBackground = frame.layers[0]?.id === selected.id
  // A background that covers the frame shows as the frame itself; a shrunk one has its own edges.
  const coveringBackground = isBackground && (!photo || coversFrame(selected, photo, frame))
  const style = { '--frame-ratio': frame.widthMm / frame.heightMm } as CSSProperties

  return (
    <div
      ref={rootRef}
      className="edit-layer"
      style={style}
      role="group"
      aria-label={t('edit.label')}
      data-edit-surface
    >
      <div ref={surfaceRef} className="edit-surface" {...bindSurface()} />
      {guides.x !== null && (
        <div className="edit-guide edit-guide--x" style={{ left: `${guides.x * 100}%` }} />
      )}
      {guides.y !== null && (
        <div className="edit-guide edit-guide--y" style={{ top: `${guides.y * 100}%` }} />
      )}
      {coveringBackground ? (
        <div className="edit-outline edit-outline--background" />
      ) : (
        photo && (
          <div className="edit-outline" style={layerPlacement(selected, photo)}>
            {CORNERS.map((corner) => (
              <div
                key={corner}
                className={`edit-handle edit-handle--${corner}`}
                {...bindHandle()}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}
