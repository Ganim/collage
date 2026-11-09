import { clampToCover, coverLayer } from './transform'
import type { Frame, Layer, Photo, Size } from './types'
import { clampWidth, zoomLimits } from './zoom'

type Photos = Record<string, Photo>

export function createFrame(size: Size): Frame {
  return { id: crypto.randomUUID(), widthMm: size.widthMm, heightMm: size.heightMm, layers: [] }
}

function fitBackground(frame: Frame, photos: Photos): Frame {
  const bg = frame.layers[0]
  const photo = bg && photos[bg.photoId]
  if (!bg || !photo) return frame
  return { ...frame, layers: [clampToCover(bg, photo, frame), ...frame.layers.slice(1)] }
}

export function placePhoto(frame: Frame, photo: Photo): Frame {
  if (frame.layers.length > 0) {
    const layer: Layer = {
      id: crypto.randomUUID(),
      photoId: photo.id,
      cx: 0.5,
      cy: 0.5,
      widthFrac: 0.5,
      rotationDeg: 0,
    }
    return { ...frame, layers: [...frame.layers, layer] }
  }
  const photoLandscape = photo.width > photo.height
  const photoPortrait = photo.height > photo.width
  const frameLandscape = frame.widthMm > frame.heightMm
  const framePortrait = frame.heightMm > frame.widthMm
  const swap = (photoLandscape && framePortrait) || (photoPortrait && frameLandscape)
  const next: Frame = swap
    ? { ...frame, widthMm: frame.heightMm, heightMm: frame.widthMm }
    : { ...frame }
  const layer: Layer = {
    id: crypto.randomUUID(),
    photoId: photo.id,
    ...coverLayer(photo, next),
  }
  return { ...next, layers: [layer] }
}

export function replaceLayerPhoto(frame: Frame, layerId: string, photo: Photo): Frame {
  const layers = frame.layers.map((l) => (l.id === layerId ? { ...l, photoId: photo.id } : l))
  return fitBackground({ ...frame, layers }, { [photo.id]: photo })
}

export function resizeFrame(frame: Frame, size: Size, photos: Photos): Frame {
  return fitBackground(
    { ...frame, widthMm: size.widthMm, heightMm: size.heightMm, layers: [...frame.layers] },
    photos,
  )
}

export function flipOrientation(frame: Frame, photos: Photos): Frame {
  return resizeFrame(frame, { widthMm: frame.heightMm, heightMm: frame.widthMm }, photos)
}

export function updateLayer(
  frame: Frame,
  layerId: string,
  patch: Partial<Omit<Layer, 'id'>>,
  photos: Photos,
): Frame {
  const layers = frame.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l))
  return fitBackground({ ...frame, layers }, photos)
}

/** Multiplies the layer's width around its centre, within what the layer allows. */
export function zoomLayer(frame: Frame, layerId: string, factor: number, photos: Photos): Frame {
  const layer = frame.layers.find((l) => l.id === layerId)
  const photo = layer && photos[layer.photoId]
  if (!layer || !photo) return frame
  const widthFrac = clampWidth(layer.widthFrac * factor, zoomLimits(frame, layer, photo))
  return updateLayer(frame, layerId, { widthFrac }, photos)
}

export function rotateLayer90(frame: Frame, layerId: string, photos: Photos): Frame {
  const layer = frame.layers.find((l) => l.id === layerId)
  if (!layer) return { ...frame, layers: [...frame.layers] }
  const rotationDeg = (layer.rotationDeg + 90) % 360
  const photo = photos[layer.photoId]
  if (frame.layers[0]?.id !== layerId || !photo) {
    return updateLayer(frame, layerId, { rotationDeg }, photos)
  }
  // Keep the background's zoom relative to cover, so four turns return to the start.
  const before = coverLayer(photo, frame, layer.rotationDeg).widthFrac
  const after = coverLayer(photo, frame, rotationDeg).widthFrac
  return updateLayer(
    frame,
    layerId,
    { rotationDeg, widthFrac: (layer.widthFrac * after) / before },
    photos,
  )
}

/** Layers are ordered bottom to top; the background (index 0) never moves. */
export function moveLayer(frame: Frame, layerId: string, direction: 'forward' | 'back'): Frame {
  const layers = [...frame.layers]
  const i = layers.findIndex((l) => l.id === layerId)
  const j = direction === 'forward' ? i + 1 : i - 1
  if (i < 1 || j < 1 || j >= layers.length) return { ...frame, layers }
  const lower = layers[i]
  const upper = layers[j]
  if (!lower || !upper) return { ...frame, layers }
  layers[i] = upper
  layers[j] = lower
  return { ...frame, layers }
}

export function removeLayer(frame: Frame, layerId: string, photos: Photos): Frame {
  const layers = frame.layers.filter((l) => l.id !== layerId)
  const bgRemoved = frame.layers[0]?.id === layerId
  if (!bgRemoved || layers.length === 0) return { ...frame, layers }
  const next = layers[0]
  const photo = next && photos[next.photoId]
  if (!next || !photo) return { ...frame, layers }
  layers[0] = { ...next, ...coverLayer(photo, frame, next.rotationDeg) }
  return { ...frame, layers }
}

export function duplicateFrame(frame: Frame): Frame {
  return {
    ...frame,
    id: crypto.randomUUID(),
    layers: frame.layers.map((l) => ({ ...l, id: crypto.randomUUID() })),
  }
}
