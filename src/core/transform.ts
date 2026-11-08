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
