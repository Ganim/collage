import type { Frame } from '../../core/types'
import { photoUsage, usageChipText } from './photoUsage'

const frame = (widthMm: number, heightMm: number, photoIds: string[]): Frame =>
  ({
    id: `${widthMm}-${heightMm}-${photoIds.join()}`,
    widthMm,
    heightMm,
    layers: photoIds.map((photoId, i) => ({ id: `l${i}`, photoId })),
  }) as unknown as Frame

describe('photoUsage', () => {
  it('lists each frame size a photo is in, once, in frame order', () => {
    const usage = photoUsage([
      frame(100, 150, ['a', 'b']),
      frame(130, 180, ['a']),
      frame(100, 150, ['a']),
      frame(105, 150, ['c', 'c']),
    ])
    expect(usage.get('a')).toEqual(['10×15', '13×18'])
    expect(usage.get('b')).toEqual(['10×15'])
    expect(usage.get('c')).toEqual(['10,5×15'])
    expect(usage.has('d')).toBe(false)
  })
})

describe('usageChipText', () => {
  it('shows the first size and how many more', () => {
    expect(usageChipText(['10×15'])).toBe('10×15')
    expect(usageChipText(['10×15', '13×18', '5×7'])).toBe('10×15 +2')
  })
})
