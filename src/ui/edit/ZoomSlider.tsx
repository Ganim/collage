import { ZoomIn, ZoomOut } from 'lucide-react'
import { SLIDER_MAX, sliderToWidth, widthToSlider, zoomLimits } from '../../core/zoom'
import { useEditor } from '../../state/editor'
import { t } from '../i18n'

export function ZoomSlider() {
  const frame = useEditor((s) => s.collection.frames.find((f) => f.id === s.activeFrameId))
  const selectedId = useEditor((s) => s.selectedLayerId)
  const photos = useEditor((s) => s.photos)
  const transformSelected = useEditor((s) => s.transformSelected)
  const layer = frame?.layers.find((l) => l.id === selectedId)
  const photo = layer && photos[layer.photoId]
  if (!frame || !layer || !photo) return null
  const limits = zoomLimits(frame, layer, photo)

  return (
    <div className="zoom-row">
      <ZoomOut size={20} />
      <input
        type="range"
        min={0}
        max={SLIDER_MAX}
        step={1}
        value={widthToSlider(layer.widthFrac, limits)}
        aria-label={t('zoom.label')}
        onChange={(e) =>
          transformSelected({ widthFrac: sliderToWidth(Number(e.target.value), limits) })
        }
      />
      <ZoomIn size={20} />
    </div>
  )
}
