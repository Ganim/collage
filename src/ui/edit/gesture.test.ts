import { describe, expect, it } from 'vitest'
import type { Layer, Photo } from '../../core/types'
import { cornerScale, dragToPatch, keepInFrame, layerAt, pinchToPatch } from './gesture'

const layer = (over: Partial<Layer> = {}): Layer => ({
  id: 'a',
  photoId: 'p',
  cx: 0.5,
  cy: 0.5,
  widthFrac: 0.4,
  rotationDeg: 0,
  ...over,
})

const framePx = { width: 500, height: 1000 }

describe('dragToPatch', () => {
  it('turns screen pixels into fractions of the frame', () => {
    const patch = dragToPatch(layer(), 50, 100, framePx)
    expect(patch.cx).toBeCloseTo(0.6)
    expect(patch.cy).toBeCloseTo(0.6)
  })

  it('only depends on the size the frame has on screen', () => {
    const small = dragToPatch(layer(), 25, 0, { width: 250, height: 500 })
    expect(small.cx).toBeCloseTo(0.6)
  })
})

describe('pinchToPatch', () => {
  it('a ratio of 2 doubles the width', () => {
    expect(pinchToPatch(layer(), 2, 0, true).widthFrac).toBeCloseTo(0.8)
  })

  it('adds the angle when rotation is allowed', () => {
    expect(pinchToPatch(layer({ rotationDeg: 10 }), 1, 30, true).rotationDeg).toBeCloseTo(40)
  })

  it('keeps the angle within a full turn', () => {
    expect(pinchToPatch(layer({ rotationDeg: 10 }), 1, -30, true).rotationDeg).toBeCloseTo(340)
  })

  it('ignores the angle when rotation is not allowed', () => {
    expect(pinchToPatch(layer({ rotationDeg: 10 }), 1, 30, false)).not.toHaveProperty('rotationDeg')
  })

  it('does not let a photo shrink out of reach', () => {
    expect(pinchToPatch(layer(), 0.01, 0, true).widthFrac).toBeCloseTo(0.1)
  })
})

describe('keepInFrame', () => {
  it('stops the centre at the edges of the frame', () => {
    expect(keepInFrame({ cx: -0.2, cy: 1.4 })).toEqual({ cx: 0, cy: 1 })
  })

  it('leaves a centre inside the frame alone', () => {
    expect(keepInFrame({ cx: 0.3, cy: 0.7 })).toEqual({ cx: 0.3, cy: 0.7 })
  })
})

describe('cornerScale', () => {
  it('is how much farther from the centre the finger went', () => {
    expect(cornerScale([0, 0], [30, 40], [60, 80])).toBeCloseTo(2)
  })

  it('does not divide by zero when pressed exactly on the centre', () => {
    expect(cornerScale([5, 5], [5, 5], [50, 50])).toBe(1)
  })
})

describe('layerAt', () => {
  const photos: Record<string, Photo> = {
    wide: { id: 'wide', width: 200, height: 100, name: 'wide' },
  }
  const square = { width: 500, height: 500 }
  const bottom = layer({ id: 'bottom', photoId: 'wide', widthFrac: 1 })
  const top = layer({ id: 'top', photoId: 'wide', widthFrac: 0.4 })

  it('finds the topmost layer under the point', () => {
    expect(layerAt([bottom, top], photos, square, 250, 250)?.id).toBe('top')
  })

  it('falls through to the layer below outside the top one', () => {
    expect(layerAt([bottom, top], photos, square, 60, 250)?.id).toBe('bottom')
  })

  it('finds nothing where there is no photo', () => {
    expect(layerAt([top], photos, square, 10, 10)).toBeUndefined()
  })

  it('takes rotation into account', () => {
    const turned = layer({ id: 'turned', photoId: 'wide', widthFrac: 0.4, rotationDeg: 90 })
    // 200×100 px turned upright: 100 px wide, 200 px tall around the centre.
    expect(layerAt([turned], photos, square, 250, 340)?.id).toBe('turned')
    expect(layerAt([turned], photos, square, 340, 250)).toBeUndefined()
  })

  it('skips a layer whose photo is missing', () => {
    expect(layerAt([layer({ photoId: 'gone' })], photos, square, 250, 250)).toBeUndefined()
  })
})
