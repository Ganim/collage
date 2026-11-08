import { describe, expect, it } from 'vitest'
import type { Frame, Layer, Photo } from '../core/types'
import type { StoredPhoto } from '../storage/store'
import { composeFrame, frameCanvasSize, layerDrawRect, type Raster } from './compose'

const photo23: Photo = { id: 'p', width: 2000, height: 3000, name: 'p.jpg' }
const canvas = { width: 1181, height: 1772 }

function layer(overrides: Partial<Layer> = {}): Layer {
  return { id: 'l', photoId: 'p', cx: 0.5, cy: 0.5, widthFrac: 1, rotationDeg: 0, ...overrides }
}

describe('frameCanvasSize', () => {
  it('renders 100x150 mm at 300 dpi', () => {
    expect(frameCanvasSize({ widthMm: 100, heightMm: 150 })).toEqual({ width: 1181, height: 1772 })
  })
})

describe('layerDrawRect', () => {
  it('keeps the photo aspect ratio and centres it', () => {
    const rect = layerDrawRect(layer(), photo23, canvas)
    expect(rect.w).toBe(1181)
    expect(rect.h).toBe(1771.5)
    expect(rect.cx).toBe(590.5)
    expect(rect.cy).toBe(886)
    expect(rect.rad).toBe(0)
  })

  it('reads cx and cy as fractions of each canvas side and widthFrac of its width', () => {
    const rect = layerDrawRect(layer({ cx: 0.25, cy: 0.75, widthFrac: 0.5 }), photo23, canvas)
    expect(rect.cx).toBe(295.25)
    expect(rect.cy).toBe(1329)
    expect(rect.w).toBe(590.5)
    expect(rect.h).toBe(885.75)
  })

  it('converts degrees to radians with the same clockwise sign as canvas rotate', () => {
    expect(layerDrawRect(layer({ rotationDeg: 90 }), photo23, canvas).rad).toBeCloseTo(
      Math.PI / 2,
      12,
    )
    expect(layerDrawRect(layer({ rotationDeg: -30 }), photo23, canvas).rad).toBeCloseTo(
      -Math.PI / 6,
      12,
    )
  })
})

describe('composeFrame', () => {
  function fakeRaster(log: unknown[][]): Raster {
    let decoded = 0
    return {
      async decode(blob) {
        const name = `bitmap${decoded++}`
        log.push(['decode', blob])
        return { name, close: () => log.push(['close', name]) } as unknown as ImageBitmap
      },
      createCanvas(width, height) {
        log.push(['createCanvas', width, height])
        const context = {
          set fillStyle(value: string) {
            log.push(['fillStyle', value])
          },
          fillRect: (...a: number[]) => log.push(['fillRect', ...a]),
          save: () => log.push(['save']),
          restore: () => log.push(['restore']),
          translate: (...a: number[]) => log.push(['translate', ...a]),
          rotate: (...a: number[]) => log.push(['rotate', ...a]),
          drawImage: (image: { name: string }, ...a: number[]) =>
            log.push(['drawImage', image.name, ...a]),
        }
        return {
          context: context as unknown as ReturnType<Raster['createCanvas']>['context'],
          async exportJpeg(quality) {
            log.push(['exportJpeg', quality])
            return new Uint8Array([1, 2, 3])
          },
        }
      },
    }
  }

  const original = new Blob(['original'])
  const preview = new Blob(['preview'])
  const stored: StoredPhoto = { ...photo23, original, preview, thumb: new Blob(['thumb']) }
  const frame: Frame = {
    id: 'f',
    widthMm: 100,
    heightMm: 150,
    layers: [layer(), layer({ id: 'l2', cx: 0.25, cy: 0.5, widthFrac: 0.5, rotationDeg: 90 })],
  }

  it('paints white, then each layer in order, closing each bitmap before the next', async () => {
    const log: unknown[][] = []
    const jpeg = await composeFrame(frame, async () => stored, fakeRaster(log))

    expect(jpeg).toEqual(new Uint8Array([1, 2, 3]))
    expect(log).toEqual([
      ['createCanvas', 1181, 1772],
      ['fillStyle', '#ffffff'],
      ['fillRect', 0, 0, 1181, 1772],
      ['decode', original],
      ['save'],
      ['translate', 590.5, 886],
      ['rotate', 0],
      ['drawImage', 'bitmap0', -590.5, -885.75, 1181, 1771.5],
      ['restore'],
      ['close', 'bitmap0'],
      ['decode', original],
      ['save'],
      ['translate', 295.25, 886],
      ['rotate', Math.PI / 2],
      ['drawImage', 'bitmap1', -295.25, -442.875, 590.5, 885.75],
      ['restore'],
      ['close', 'bitmap1'],
      ['exportJpeg', 0.92],
    ])
  })

  it('closes the bitmap when drawing fails', async () => {
    const log: unknown[][] = []
    const raster = fakeRaster(log)
    const failing: Raster = {
      decode: raster.decode,
      createCanvas(width, height) {
        const created = raster.createCanvas(width, height)
        created.context.drawImage = () => {
          throw new Error('draw failed')
        }
        return created
      },
    }
    await expect(composeFrame(frame, async () => stored, failing)).rejects.toThrow('draw failed')
    expect(log).toContainEqual(['close', 'bitmap0'])
  })
})
