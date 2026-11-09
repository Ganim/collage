import { describe, expect, it } from 'vitest'
import { createFrame, placePhoto, removePhotoLayers } from './frame'
import type { Frame, Photo } from './types'

const a: Photo = { id: 'a', width: 400, height: 600, name: 'a' }
const b: Photo = { id: 'b', width: 400, height: 600, name: 'b' }
const photos = { a, b }
const place = (...list: Photo[]): Frame =>
  list.reduce(placePhoto, createFrame({ widthMm: 100, heightMm: 150 }))
const shown = (frame: Frame) => frame.layers.map((l) => l.photoId)

describe('removePhotoLayers', () => {
  it('removes every layer showing the photo and keeps the others', () => {
    expect(shown(removePhotoLayers(place(b, a, b, a), 'a', photos))).toEqual(['b', 'b'])
  })

  it('makes the next photo cover the frame when the background goes', () => {
    const removed = removePhotoLayers(place(a, b), 'a', photos)
    expect(shown(removed)).toEqual(['b'])
    expect(removed.layers[0]?.widthFrac).toBeCloseTo(1)
    expect(removed.layers[0]?.cx).toBeCloseTo(0.5)
  })

  it('still finds a cover when the photo fills the first two layers', () => {
    const removed = removePhotoLayers(place(a, a, b), 'a', photos)
    expect(shown(removed)).toEqual(['b'])
    expect(removed.layers[0]?.widthFrac).toBeCloseTo(1)
  })

  it('leaves a frame without that photo untouched', () => {
    const frame = place(b)
    expect(removePhotoLayers(frame, 'a', photos)).toBe(frame)
  })
})
