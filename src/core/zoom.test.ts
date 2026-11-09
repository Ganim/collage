import { describe, expect, it } from 'vitest'
import { createFrame, placePhoto, rotateLayer90, zoomLayer } from './frame'
import type { Frame, Layer, Photo } from './types'
import { freeAxes } from './transform'
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
  it('runs the background from covering the frame to four times that', () => {
    const frame = withBackground()
    expect(zoomLimits(frame, at(frame, 0), portrait)).toEqual({ min: 1, max: 4 })
  })

  it('follows the cover width of the background once it is rotated', () => {
    const frame = placePhoto(createFrame({ widthMm: 150, heightMm: 100 }), wide)
    const turned = rotateLayer90(frame, at(frame, 0).id, photos)
    const { min, max } = zoomLimits(turned, at(turned, 0), wide)
    expect(min).toBeCloseTo(at(turned, 0).widthFrac)
    expect(max).toBeCloseTo(min * 4)
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

  it('never lets the background uncover the frame', () => {
    const frame = withBackground()
    const id = at(frame, 0).id
    const big = zoomLayer(frame, id, 3, photos)
    const back = at(zoomLayer(big, id, 1e-9, photos), 0)
    expect(at(big, 0).widthFrac).toBeCloseTo(3)
    expect(back.widthFrac).toBe(1)
    expect(back.cx).toBeCloseTo(0.5)
    expect(back.cy).toBeCloseTo(0.5)
  })

  it('leaves the frame alone when the layer or its photo is unknown', () => {
    const frame = withOverlay()
    expect(zoomLayer(frame, 'nope', 2, photos)).toBe(frame)
    expect(zoomLayer(frame, at(frame, 1).id, 2, {})).toBe(frame)
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

  it('finds room only along the side the photo overflows', () => {
    const square: Photo = { id: 's', width: 1000, height: 1000, name: 's' }
    const frame = placePhoto(createFrame({ widthMm: 100, heightMm: 150 }), square)
    expect(freeAxes(at(frame, 0), square, frame)).toEqual({ x: true, y: false })
  })
})
