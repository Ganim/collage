import { coverLayer } from './transform'
import type { Frame, Layer, Photo } from './types'

export interface ZoomLimits {
  min: number
  max: number
}

export const SLIDER_MAX = 1000

/** Below this a photo is smaller than the finger trying to grab it. */
export const MIN_WIDTH_FRAC = 0.1
const MAX_WIDTH_FRAC = 3
const MAX_BACKGROUND_ZOOM = 4

export function zoomLimits(frame: Frame, layer: Layer, photo: Photo): ZoomLimits {
  if (frame.layers[0]?.id !== layer.id) return { min: MIN_WIDTH_FRAC, max: MAX_WIDTH_FRAC }
  const min = coverLayer(photo, frame, layer.rotationDeg).widthFrac
  return { min, max: min * MAX_BACKGROUND_ZOOM }
}

export function clampWidth(width: number, { min, max }: ZoomLimits): number {
  return Math.min(max, Math.max(min, width))
}

/** Logarithmic, so the same slide always changes the size by the same proportion. */
export function sliderToWidth(value: number, { min, max }: ZoomLimits): number {
  if (value <= 0) return min
  if (value >= SLIDER_MAX) return max
  return min * (max / min) ** (value / SLIDER_MAX)
}

export function widthToSlider(width: number, limits: ZoomLimits): number {
  const { min, max } = limits
  return Math.round((Math.log(clampWidth(width, limits) / min) / Math.log(max / min)) * SLIDER_MAX)
}
