import type { Frame, Layer, Photo } from './types'

/** Layers printed below this resolution are flagged. Exactly this value is fine. */
export const MIN_DPI = 150

export function layerDpi(layer: Layer, photo: Photo, frame: Frame): number {
  const shownMm = layer.widthFrac * frame.widthMm
  return photo.width / (shownMm / 25.4)
}

export function lowResolutionLayers(
  frames: Frame[],
  photos: Record<string, Photo>,
): { frameId: string; layerId: string; dpi: number }[] {
  const out: { frameId: string; layerId: string; dpi: number }[] = []
  for (const frame of frames) {
    for (const layer of frame.layers) {
      const photo = photos[layer.photoId]
      if (!photo) continue
      const dpi = layerDpi(layer, photo, frame)
      if (dpi < MIN_DPI) out.push({ frameId: frame.id, layerId: layer.id, dpi })
    }
  }
  return out
}

export function emptyFrames(frames: Frame[]): string[] {
  return frames.filter((f) => f.layers.length === 0).map((f) => f.id)
}
