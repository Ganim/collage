import { describe, expect, it } from 'vitest'
import {
  createFrame,
  duplicateFrame,
  flipOrientation,
  moveLayer,
  placePhoto,
  removeLayer,
  resizeFrame,
  rotateLayer90,
  updateLayer,
} from './frame'
import { defaultPaper, FRAME_PRESETS, PAPER_PRESETS } from './presets'
import { emptyFrames, layerDpi, lowResolutionLayers } from './quality'
import { clampToCover, coverLayer } from './transform'
import type { Frame, Layer, Photo } from './types'

const photo = (id: string, width: number, height: number): Photo => ({
  id,
  width,
  height,
  name: id,
})
const wide = photo('wide', 3000, 2000)
const square = photo('sq', 1000, 1000)
const photos = { wide, sq: square }
function at(f: Frame, i: number): Layer {
  const l = f.layers[i]
  if (!l) throw new Error(`no layer ${i}`)
  return l
}
const portraitFrame = (): Frame => createFrame({ widthMm: 100, heightMm: 150 })

// A rotated photo covers the frame if every frame corner lies inside it.
function covers(layer: Layer, p: Photo, f: Frame): boolean {
  const r = (layer.rotationDeg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const a = (layer.widthFrac * f.widthMm) / 2
  const b = (a * p.height) / p.width
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].every(([sx = 0, sy = 0]) => {
    const x = sx * (f.widthMm / 2) - (layer.cx - 0.5) * f.widthMm
    const y = sy * (f.heightMm / 2) - (layer.cy - 0.5) * f.heightMm
    return Math.abs(x * c + y * s) <= a + 1e-6 && Math.abs(-x * s + y * c) <= b + 1e-6
  })
}

describe('coverLayer', () => {
  it('covers a portrait frame with a landscape photo', () => {
    const l = coverLayer(wide, portraitFrame())
    expect(l.widthFrac).toBeCloseTo(2.25)
    expect(l.cx).toBe(0.5)
    expect(l.cy).toBe(0.5)
  })
  it('accounts for a 90 degree rotation', () => {
    expect(coverLayer(wide, portraitFrame(), 90).widthFrac).toBeCloseTo(1.5)
  })
})

describe('clampToCover', () => {
  const frame = portraitFrame()
  const base: Layer = { id: 'l', photoId: 'wide', ...coverLayer(wide, frame) }
  it('pulls a dragged centre back without leaving an empty corner', () => {
    const out = clampToCover({ ...base, widthFrac: 3, cx: 2 }, wide, frame)
    expect(out.cx).toBeLessThan(2)
    expect(out.cx).toBeGreaterThan(0.5)
    expect(covers(out, wide, frame)).toBe(true)
  })
  it('raises a scale below cover back to cover', () => {
    const out = clampToCover({ ...base, widthFrac: 0.3 }, wide, frame)
    expect(out.widthFrac).toBeCloseTo(2.25)
    expect(covers(out, wide, frame)).toBe(true)
  })
  it('works at arbitrary angles', () => {
    const out = clampToCover(
      { ...base, rotationDeg: 30, cx: 5, cy: -3, widthFrac: 0.1 },
      wide,
      frame,
    )
    expect(covers(out, wide, frame)).toBe(true)
  })
})

describe('placePhoto', () => {
  it('flips an empty frame for a landscape photo', () => {
    const f = placePhoto(portraitFrame(), wide)
    expect([f.widthMm, f.heightMm]).toEqual([150, 100])
    expect(f.layers).toHaveLength(1)
    expect(covers(at(f, 0), wide, f)).toBe(true)
  })
  it('keeps orientation for a square photo', () => {
    const f = placePhoto(portraitFrame(), square)
    expect([f.widthMm, f.heightMm]).toEqual([100, 150])
  })
  it('adds a centred layer on top and leaves the background alone', () => {
    const f1 = placePhoto(portraitFrame(), wide)
    const f2 = placePhoto(f1, square)
    expect(f2.layers).toHaveLength(2)
    expect(at(f2, 0)).toEqual(at(f1, 0))
    expect(at(f2, 1)).toMatchObject({ photoId: 'sq', cx: 0.5, cy: 0.5, widthFrac: 0.5 })
  })
})

describe('frame rules', () => {
  const two = () => placePhoto(placePhoto(portraitFrame(), wide), square)

  it('resizeFrame keeps layers and re-covers the background', () => {
    const f = resizeFrame(two(), { widthMm: 300, heightMm: 100 }, photos)
    expect(f.layers).toHaveLength(2)
    expect(covers(at(f, 0), wide, f)).toBe(true)
  })
  it('flipOrientation swaps the sides', () => {
    const f = flipOrientation(two(), photos)
    expect([f.widthMm, f.heightMm]).toEqual([100, 150])
    expect(covers(at(f, 0), wide, f)).toBe(true)
  })
  it('rotateLayer90 adds 90 on the background and still covers; four turns return', () => {
    const f0 = placePhoto(portraitFrame(), wide)
    const id = at(f0, 0).id
    const f1 = rotateLayer90(f0, id, photos)
    expect(at(f1, 0).rotationDeg).toBe(90)
    expect(covers(at(f1, 0), wide, f1)).toBe(true)
    let f = f0
    for (let i = 0; i < 4; i++) f = rotateLayer90(f, id, photos)
    expect(at(f, 0).rotationDeg).toBe(0)
    expect(at(f, 0).widthFrac).toBeCloseTo(at(f0, 0).widthFrac)
  })
  it('moveLayer never lets a top layer reach index 0', () => {
    const f = two()
    const top = at(f, 1).id
    expect(at(moveLayer(f, top, 'back'), 0).id).toBe(at(f, 0).id)
    expect(at(moveLayer(f, at(f, 0).id, 'forward'), 0).id).toBe(at(f, 0).id)
  })
  it('moveLayer swaps upper layers', () => {
    const f = placePhoto(two(), square)
    const a = at(f, 1)
    const b = at(f, 2)
    const g = moveLayer(f, a.id, 'forward')
    expect(g.layers.map((l) => l.id)).toEqual([at(f, 0).id, b.id, a.id])
  })
  it('removeLayer on the background promotes the next layer, covering', () => {
    const f = two()
    const g = removeLayer(f, at(f, 0).id, photos)
    expect(g.layers).toHaveLength(1)
    expect(at(g, 0).id).toBe(at(f, 1).id)
    expect(covers(at(g, 0), square, g)).toBe(true)
  })
  it('updateLayer clamps the background', () => {
    const f = placePhoto(portraitFrame(), wide)
    const g = updateLayer(f, at(f, 0).id, { cx: 9 }, photos)
    expect(covers(at(g, 0), wide, g)).toBe(true)
  })
  it('duplicateFrame gives new ids and does not alias', () => {
    const f = two()
    const d = duplicateFrame(f)
    expect(d.id).not.toBe(f.id)
    expect(at(d, 0).id).not.toBe(at(f, 0).id)
    expect(at(d, 0).photoId).toBe(at(f, 0).photoId)
  })
})

describe('quality', () => {
  const frame = (w: number, widthFrac: number, p: Photo): Frame => ({
    id: 'f',
    widthMm: w,
    heightMm: 100,
    layers: [{ id: 'l', photoId: p.id, cx: 0.5, cy: 0.5, widthFrac, rotationDeg: 0 }],
  })
  it('layerDpi', () => {
    const p = photo('p', 1181, 800)
    const f = frame(100, 1, p)
    expect(layerDpi(at(f, 0), p, f)).toBeCloseTo(300, 0)
  })
  it('flags below 150 dpi only', () => {
    const lo = photo('lo', 400, 300)
    expect(lowResolutionLayers([frame(100, 1, lo)], { lo })).toHaveLength(1)
    const a = photo('a', 149, 100)
    const b = photo('b', 150, 100)
    expect(lowResolutionLayers([frame(25.4, 1, a)], { a })).toHaveLength(1)
    expect(lowResolutionLayers([frame(25.4, 1, b)], { b })).toHaveLength(0)
  })
  it('emptyFrames lists only frames without layers', () => {
    const e = createFrame({ widthMm: 1, heightMm: 1 })
    expect(emptyFrames([e, frame(100, 1, wide)])).toEqual([e.id])
  })
})

describe('presets', () => {
  it('lists the frame and paper presets in mm', () => {
    expect(FRAME_PRESETS.map((p) => [p.widthMm, p.heightMm])).toEqual([
      [100, 150],
      [130, 180],
      [150, 210],
      [200, 250],
      [200, 300],
      [50, 70],
    ])
    expect(PAPER_PRESETS.map((p) => p.label)).toEqual(['A4', 'A3', 'Letter'])
    expect(defaultPaper()).toEqual({ widthMm: 210, heightMm: 297, marginMm: 5, gapMm: 3 })
  })
})
