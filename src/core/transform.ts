import type { Frame, Layer, Photo } from './types'

type Placement = Omit<Layer, 'id' | 'photoId'>

const EPS = 1e-9

function cosSin(deg: number): [number, number] {
  const n = ((deg % 360) + 360) % 360
  if (n === 0) return [1, 0]
  if (n === 90) return [0, 1]
  if (n === 180) return [-1, 0]
  if (n === 270) return [0, -1]
  const r = (deg * Math.PI) / 180
  return [Math.cos(r), Math.sin(r)]
}

/** Frame corners relative to the frame centre, in millimetres. */
function corners(frame: Frame): [number, number][] {
  const hw = frame.widthMm / 2
  const hh = frame.heightMm / 2
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]
}

/** Smallest unrotated photo width (mm) that covers the frame at the given rotation. */
function minWidthMm(photo: Photo, frame: Frame, rotationDeg: number): number {
  const [c, s] = cosSin(rotationDeg)
  const ratio = photo.height / photo.width
  let mx = 0
  let my = 0
  for (const [px, py] of corners(frame)) {
    mx = Math.max(mx, Math.abs(px * c + py * s))
    my = Math.max(my, Math.abs(-px * s + py * c))
  }
  return Math.max(2 * mx, (2 * my) / ratio)
}

export function coverLayer(photo: Photo, frame: Frame, rotationDeg = 0): Placement {
  return {
    cx: 0.5,
    cy: 0.5,
    widthFrac: minWidthMm(photo, frame, rotationDeg) / frame.widthMm,
    rotationDeg,
  }
}

/** The width, as a fraction of the frame width, at which the whole photo just fits inside the frame. */
export function containWidthFrac(photo: Photo, frame: Frame, rotationDeg = 0): number {
  const [c, s] = cosSin(rotationDeg)
  const ratio = photo.height / photo.width
  const [ac, as] = [Math.abs(c), Math.abs(s)]
  const widthMm = Math.min(frame.widthMm / (ac + ratio * as), frame.heightMm / (as + ratio * ac))
  return widthMm / frame.widthMm
}

/** True when the layer, at its size and turn, is big enough to hide the whole frame. */
export function coversFrame(layer: Layer, photo: Photo, frame: Frame): boolean {
  return layer.widthFrac >= minWidthMm(photo, frame, layer.rotationDeg) / frame.widthMm - 1e-6
}

/**
 * Keeps a background where it belongs: one big enough to cover the frame keeps covering it; a
 * smaller one stays inside the frame along each side it does not fill, so the fill colour shows
 * only around the photo, never a photo cut off next to a gap.
 */
export function clampBackground(layer: Layer, photo: Photo, frame: Frame, minFrac = 0): Layer {
  const widthFrac = Math.max(layer.widthFrac, minFrac)
  const sized = { ...layer, widthFrac }
  if (coversFrame(sized, photo, frame)) return clampToCover(sized, photo, frame)
  const [c, s] = cosSin(layer.rotationDeg)
  const w = widthFrac * frame.widthMm
  const h = (w * photo.height) / photo.width
  const boxW = w * Math.abs(c) + h * Math.abs(s)
  const boxH = w * Math.abs(s) + h * Math.abs(c)
  const centre = (frac: number, box: number, side: number) => {
    const half = box / 2
    const lo = Math.min(half, side - half)
    const hi = Math.max(half, side - half)
    return Math.min(hi, Math.max(lo, frac * side)) / side
  }
  return {
    ...sized,
    cx: centre(layer.cx, boxW, frame.widthMm),
    cy: centre(layer.cy, boxH, frame.heightMm),
  }
}

/** Which ways a background can still move while staying where it belongs. */
export function freeAxes(layer: Layer, photo: Photo, frame: Frame): { x: boolean; y: boolean } {
  const low = clampBackground({ ...layer, cx: 0, cy: 0 }, photo, frame)
  const high = clampBackground({ ...layer, cx: 1, cy: 1 }, photo, frame)
  return { x: high.cx - low.cx > EPS, y: high.cy - low.cy > EPS }
}

export function clampToCover(layer: Layer, photo: Photo, frame: Frame): Layer {
  const [c, s] = cosSin(layer.rotationDeg)
  const minFrac = minWidthMm(photo, frame, layer.rotationDeg) / frame.widthMm
  const widthFrac = Math.max(layer.widthFrac, minFrac)
  const a = (widthFrac * frame.widthMm) / 2
  const b = (a * photo.height) / photo.width

  // In the layer's own axes the allowed centre is an axis-aligned box.
  let loX = -Infinity
  let hiX = Infinity
  let loY = -Infinity
  let hiY = Infinity
  for (const [px, py] of corners(frame)) {
    const lx = px * c + py * s
    const ly = -px * s + py * c
    loX = Math.max(loX, lx - a)
    hiX = Math.min(hiX, lx + a)
    loY = Math.max(loY, ly - b)
    hiY = Math.min(hiY, ly + b)
  }
  if (loX > hiX - EPS) loX = hiX = (loX + hiX) / 2
  if (loY > hiY - EPS) loY = hiY = (loY + hiY) / 2

  const dx = (layer.cx - 0.5) * frame.widthMm
  const dy = (layer.cy - 0.5) * frame.heightMm
  const lx = Math.min(hiX, Math.max(loX, dx * c + dy * s))
  const ly = Math.min(hiY, Math.max(loY, -dx * s + dy * c))
  return {
    ...layer,
    widthFrac,
    cx: 0.5 + (lx * c - ly * s) / frame.widthMm,
    cy: 0.5 + (lx * s + ly * c) / frame.heightMm,
  }
}
