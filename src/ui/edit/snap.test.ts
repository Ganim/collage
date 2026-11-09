import { describe, expect, it } from 'vitest'
import { snapToCenters } from './snap'

const frame = { width: 400, height: 600 }
const targets = { x: [0.5, 0.25], y: [0.5] }

describe('snapToCenters', () => {
  it('leaves a position that is near nothing alone, with no guides', () => {
    expect(snapToCenters({ cx: 0.8, cy: 0.8 }, targets, frame)).toEqual({
      cx: 0.8,
      cy: 0.8,
      guideX: null,
      guideY: null,
    })
  })

  it('pulls a close axis onto the target and marks only that axis', () => {
    expect(snapToCenters({ cx: 0.51, cy: 0.8 }, targets, frame)).toEqual({
      cx: 0.5,
      cy: 0.8,
      guideX: 0.5,
      guideY: null,
    })
  })

  it('aligns both axes independently', () => {
    const snapped = snapToCenters({ cx: 0.49, cy: 0.505 }, targets, frame)
    expect(snapped).toMatchObject({ cx: 0.5, cy: 0.5, guideX: 0.5, guideY: 0.5 })
  })

  it('reaches the centre of another photo', () => {
    expect(snapToCenters({ cx: 0.26, cy: 0.8 }, targets, frame).guideX).toBe(0.25)
  })

  it('measures the distance in screen pixels', () => {
    // 8 px is 0.02 of a 400 px wide frame, and about 0.0133 of a 600 px tall one.
    expect(snapToCenters({ cx: 0.519, cy: 0.8 }, targets, frame).guideX).toBe(0.5)
    expect(snapToCenters({ cx: 0.521, cy: 0.8 }, targets, frame).guideX).toBeNull()
    expect(snapToCenters({ cx: 0.8, cy: 0.512 }, targets, frame).guideY).toBe(0.5)
    expect(snapToCenters({ cx: 0.8, cy: 0.515 }, targets, frame).guideY).toBeNull()
  })

  it('takes the nearest target when two are in reach', () => {
    const close = { x: [0.5, 0.51], y: [] }
    expect(snapToCenters({ cx: 0.507, cy: 0.8 }, close, frame).guideX).toBe(0.51)
  })
})
