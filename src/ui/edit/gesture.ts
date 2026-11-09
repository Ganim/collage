import type { Layer, Photo } from '../../core/types'

export type LayerPatch = Partial<Pick<Layer, 'cx' | 'cy' | 'widthFrac' | 'rotationDeg'>>
export type Point = readonly [number, number]

/** The size the frame has on screen, in CSS pixels. */
export interface FramePx {
  width: number
  height: number
}

/** Below this a photo is smaller than the finger trying to grab it. */
const MIN_WIDTH_FRAC = 0.1

export function dragToPatch(
  layer: Layer,
  dxPx: number,
  dyPx: number,
  framePx: FramePx,
): Required<Pick<LayerPatch, 'cx' | 'cy'>> {
  return { cx: layer.cx + dxPx / framePx.width, cy: layer.cy + dyPx / framePx.height }
}

export function pinchToPatch(
  layer: Layer,
  scaleRatio: number,
  angleDelta: number,
  allowRotate: boolean,
): LayerPatch {
  const widthFrac = Math.max(MIN_WIDTH_FRAC, layer.widthFrac * scaleRatio)
  if (!allowRotate) return { widthFrac }
  return { widthFrac, rotationDeg: (((layer.rotationDeg + angleDelta) % 360) + 360) % 360 }
}

/** The frame clips its photos: a centre inside it keeps part of the photo there to tap. */
export function keepInFrame(patch: { cx: number; cy: number }): { cx: number; cy: number } {
  return { cx: Math.min(1, Math.max(0, patch.cx)), cy: Math.min(1, Math.max(0, patch.cy)) }
}

/** The resize a corner handle asks for: how much farther from the layer's centre it went. */
export function cornerScale(center: Point, start: Point, now: Point): number {
  const from = Math.hypot(start[0] - center[0], start[1] - center[1])
  if (from === 0) return 1
  return Math.hypot(now[0] - center[0], now[1] - center[1]) / from
}

/** The topmost layer at a point given in pixels from the frame's top-left corner. */
export function layerAt(
  layers: readonly Layer[],
  photos: Record<string, Photo>,
  framePx: FramePx,
  xPx: number,
  yPx: number,
): Layer | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    const photo = layer && photos[layer.photoId]
    if (!layer || !photo) continue
    const halfWidth = (layer.widthFrac * framePx.width) / 2
    const halfHeight = (halfWidth * photo.height) / photo.width
    const dx = xPx - layer.cx * framePx.width
    const dy = yPx - layer.cy * framePx.height
    const r = (layer.rotationDeg * Math.PI) / 180
    const localX = dx * Math.cos(r) + dy * Math.sin(r)
    const localY = -dx * Math.sin(r) + dy * Math.cos(r)
    if (Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight) return layer
  }
  return undefined
}
