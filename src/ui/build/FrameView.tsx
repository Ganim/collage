import type { CSSProperties } from 'react'
import type { Frame } from '../../core/types'
import { useEditor } from '../../state/editor'
import { LayerImage } from './LayerImage'

interface FrameViewProps {
  frame: Frame
  /** When false the frame ignores touches, so a swipe over it reaches what is underneath. */
  interactive: boolean
  onTap?: () => void
  label?: string
  showImages?: boolean
}

/** Fills the nearest size container, preserving the frame's proportions. */
export function FrameView({ frame, interactive, onTap, label, showImages = true }: FrameViewProps) {
  const photos = useEditor((s) => s.photos)
  const style = { '--frame-ratio': frame.widthMm / frame.heightMm } as CSSProperties
  return (
    <div
      role="img"
      aria-label={label}
      className={interactive ? 'frame frame--interactive' : 'frame'}
      style={style}
      onClick={interactive ? onTap : undefined}
    >
      {showImages &&
        frame.layers.map((layer) => {
          const photo = photos[layer.photoId]
          return photo ? <LayerImage key={layer.id} layer={layer} photo={photo} /> : null
        })}
    </div>
  )
}
