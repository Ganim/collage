import { describe, expect, it } from 'vitest'
import {
  createFrame,
  placePhoto,
  resizeFrame,
  rotateLayer90,
  updateLayer,
  zoomLayer,
} from './frame'
import type { Frame, Layer, Photo } from './types'
import { clampBackground, containWidthFrac, coverLayer, coversFrame, freeAxes } from './transform'
import { SLIDER_MAX, sliderToWidth, widthToSlider, zoomLimits } from './zoom'

const portrait: Photo = { id: 'p', width: 400, height: 600, name: 'p' }
const wide: Photo = { id: 'w', width: 3000, height: 2000, name: 'w' }
const photos = { p: portrait, w: wide }

function at(frame: Frame, i: number): Layer {
  const layer = frame.layers[i]
  if (!layer) throw new Error(`no layer ${i}`)
  return layer
}

const withBackground = () => placePhoto(createFrame({ widthMm: 100, heightMm: 150 }), portrait)
const withOverlay = () => placePhoto(withBackground(), portrait)

describe('zoomLimits', () => {
  it('runs the background from 10% of the frame to four times covering it', () => {
    const frame = withBackground()
    expect(zoomLimits(frame, at(frame, 0), portrait)).toEqual({ min: 0.1, max: 4 })
  })

  it('follows the cover width of the background once it is rotated', () => {
    const frame = placePhoto(createFrame({ widthMm: 150, heightMm: 100 }), wide)
    const turned = rotateLayer90(frame, at(frame, 0).id, photos)
    const { max } = zoomLimits(turned, at(turned, 0), wide)
    expect(max).toBeCloseTo(at(turned, 0).widthFrac * 4)
  })

  it('lets a very narrow background go down to fitting whole, even below 10%', () => {
    const sliver: Photo = { id: 'n', width: 100, height: 10000, name: 'n' }
    const frame = placePhoto(createFrame({ widthMm: 150, heightMm: 100 }), sliver)
    const fit = containWidthFrac(sliver, frame, at(frame, 0).rotationDeg)
    expect(fit).toBeLessThan(0.1)
    expect(zoomLimits(frame, at(frame, 0), sliver).min).toBeCloseTo(fit)
  })

  it('runs a photo on top from 10% to 300% of the frame width', () => {
    const frame = withOverlay()
    expect(zoomLimits(frame, at(frame, 1), portrait)).toEqual({ min: 0.1, max: 3 })
  })
})

describe('slider scale', () => {
  const limits = { min: 0.1, max: 3 }

  it('gives the exact limits at both ends', () => {
    expect(sliderToWidth(0, limits)).toBe(0.1)
    expect(sliderToWidth(SLIDER_MAX, limits)).toBe(3)
  })

  it('is logarithmic, so each step changes the size by the same proportion', () => {
    expect(sliderToWidth(SLIDER_MAX / 2, { min: 1, max: 4 })).toBeCloseTo(2)
    expect(widthToSlider(0.5, limits)).toBe(473)
  })

  it('stays on the ends for a width outside the limits', () => {
    expect(widthToSlider(0.01, limits)).toBe(0)
    expect(widthToSlider(9, limits)).toBe(SLIDER_MAX)
  })

  it('returns to the same position after a round trip', () => {
    for (let value = 0; value <= SLIDER_MAX; value += 37) {
      expect(widthToSlider(sliderToWidth(value, limits), limits)).toBe(value)
    }
  })
})

describe('zoomLayer', () => {
  it('scales a photo on top around its centre', () => {
    const frame = withOverlay()
    const zoomed = at(zoomLayer(frame, at(frame, 1).id, 2, photos), 1)
    expect(zoomed.widthFrac).toBeCloseTo(1)
    expect(zoomed.cx).toBe(0.5)
    expect(zoomed.cy).toBe(0.5)
  })

  it('stops a photo on top at its limits', () => {
    const frame = withOverlay()
    const id = at(frame, 1).id
    expect(at(zoomLayer(frame, id, 1e9, photos), 1).widthFrac).toBe(3)
    expect(at(zoomLayer(frame, id, 1e-9, photos), 1).widthFrac).toBe(0.1)
  })

  it('shrinks the background below the frame, down to its limit', () => {
    const frame = withBackground()
    const id = at(frame, 0).id
    const big = zoomLayer(frame, id, 3, photos)
    const back = at(zoomLayer(big, id, 1e-9, photos), 0)
    expect(at(big, 0).widthFrac).toBeCloseTo(3)
    expect(back.widthFrac).toBe(0.1)
    expect(back.cx).toBeCloseTo(0.5)
    expect(back.cy).toBeCloseTo(0.5)
  })

  it('keeps a background that covers the frame from leaving a gap at an edge', () => {
    const frame = withBackground()
    const id = at(frame, 0).id
    const zoomed = zoomLayer(frame, id, 2, photos)
    const moved = at(updateLayer(zoomed, id, { cx: 5, cy: -5 }, photos), 0)
    expect(coversFrame(moved, portrait, zoomed)).toBe(true)
    expect(moved.cx).toBeCloseTo(1)
    expect(moved.cy).toBeCloseTo(0)
  })

  it('leaves the frame alone when the layer or its photo is unknown', () => {
    const frame = withOverlay()
    expect(zoomLayer(frame, 'nope', 2, photos)).toBe(frame)
    expect(zoomLayer(frame, at(frame, 1).id, 2, {})).toBe(frame)
  })
})

describe('clampBackground', () => {
  const frame = createFrame({ widthMm: 100, heightMm: 150 })
  const square: Photo = { id: 's', width: 1000, height: 1000, name: 's' }
  const layer = (patch: Partial<Layer>): Layer => ({
    id: 'l',
    photoId: 's',
    cx: 0.5,
    cy: 0.5,
    widthFrac: 1,
    rotationDeg: 0,
    ...patch,
  })

  it('keeps a background smaller than the frame wholly inside it', () => {
    const small = clampBackground(layer({ widthFrac: 0.5, cx: 0, cy: 1 }), square, frame)
    expect(small.cx).toBeCloseTo(0.25)
    expect(small.cy).toBeCloseTo(1 - 25 / 150)
  })

  it('keeps the side a background still overflows covered', () => {
    // 100 mm wide, 100 mm tall: fills the width exactly, leaves room above and below.
    const fits = clampBackground(layer({ cx: 0.9, cy: 0.9 }), square, frame)
    expect(fits.cx).toBeCloseTo(0.5)
    expect(fits.cy).toBeCloseTo(1 - 50 / 150)
    const wider = clampBackground(layer({ widthFrac: 1.2, cx: 0, cy: 0 }), square, frame)
    expect(wider.cx).toBeCloseTo(0.4)
    expect(wider.cy).toBeCloseTo(60 / 150)
  })

  it('never makes the background smaller than asked', () => {
    expect(clampBackground(layer({ widthFrac: 0.05 }), square, frame, 0.1).widthFrac).toBe(0.1)
  })
})

describe('resizing with a shrunk background', () => {
  it('keeps a covering background covering a frame of other proportions', () => {
    const frame = withBackground()
    const resized = resizeFrame(frame, { widthMm: 150, heightMm: 100 }, photos)
    expect(coversFrame(at(resized, 0), portrait, resized)).toBe(true)
  })

  it('leaves a shrunk background shrunk', () => {
    const frame = withBackground()
    const small = zoomLayer(frame, at(frame, 0).id, 0.5, photos)
    const resized = resizeFrame(small, { widthMm: 120, heightMm: 150 }, photos)
    expect(at(resized, 0).widthFrac).toBeCloseTo(0.5)
    expect(coverLayer(portrait, resized).widthFrac).toBeGreaterThan(0.5)
  })
})

describe('freeAxes', () => {
  it('finds no room to move on a background that exactly covers the frame', () => {
    const frame = withBackground()
    expect(freeAxes(at(frame, 0), portrait, frame)).toEqual({ x: false, y: false })
  })

  it('finds room on both axes once the background is zoomed in', () => {
    const frame = withBackground()
    const zoomed = zoomLayer(frame, at(frame, 0).id, 2, photos)
    expect(freeAxes(at(zoomed, 0), portrait, zoomed)).toEqual({ x: true, y: true })
  })

  it('finds room to move a background smaller than the frame', () => {
    const frame = withBackground()
    const small = zoomLayer(frame, at(frame, 0).id, 0.5, photos)
    expect(freeAxes(at(small, 0), portrait, small)).toEqual({ x: true, y: true })
  })

  it('finds room only along the side the photo overflows', () => {
    const square: Photo = { id: 's', width: 1000, height: 1000, name: 's' }
    const frame = placePhoto(createFrame({ widthMm: 100, heightMm: 150 }), square)
    expect(freeAxes(at(frame, 0), square, frame)).toEqual({ x: true, y: false })
  })
})
