import type { Layer, Photo } from '../../core/types'
import { usePhotoUrl } from '../usePhotoUrl'

export function LayerImage({ layer, photo }: { layer: Layer; photo: Photo }) {
  const url = usePhotoUrl(photo.id, 'preview')
  if (!url) return null
  return (
    <img
      className="frame-layer"
      src={url}
      alt=""
      draggable={false}
      style={{
        left: `${layer.cx * 100}%`,
        top: `${layer.cy * 100}%`,
        width: `${layer.widthFrac * 100}%`,
        aspectRatio: `${photo.width} / ${photo.height}`,
        transform: `translate(-50%, -50%) rotate(${layer.rotationDeg}deg)`,
      }}
    />
  )
}
