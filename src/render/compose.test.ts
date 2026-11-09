import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Frame, Layer, Photo } from '../core/types'
import type { StoredPhoto } from '../storage/store'
import { browserRaster, composeFrame, frameCanvasSize, layerDrawRect, type Raster } from './compose'

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
          release: () => log.push(['release']),
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
      ['release'],
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
    expect(log).toContainEqual(['release'])
  })

  it('releases the canvas when a photo cannot be loaded or exported', async () => {
    const log: unknown[][] = []
    const lost = composeFrame(
      frame,
      async () => {
        throw new Error('gone')
      },
      fakeRaster(log),
    )
    await expect(lost).rejects.toThrow('gone')
    expect(log).toContainEqual(['release'])

    const exportLog: unknown[][] = []
    const raster = fakeRaster(exportLog)
    const failing: Raster = {
      decode: raster.decode,
      createCanvas(width, height) {
        const created = raster.createCanvas(width, height)
        created.exportJpeg = async () => {
          throw new Error('export failed')
        }
        return created
      },
    }
    await expect(composeFrame(frame, async () => stored, failing)).rejects.toThrow('export failed')
    expect(exportLog).toContainEqual(['release'])
  })

  it('draws with high quality smoothing, since this is the print output', async () => {
    const seen: (string | boolean | undefined)[] = []
    const raster = fakeRaster([])
    const watching: Raster = {
      decode: raster.decode,
      createCanvas(width, height) {
        const created = raster.createCanvas(width, height)
        const { context } = created
        context.drawImage = () => {
          seen.push(context.imageSmoothingEnabled, context.imageSmoothingQuality)
        }
        return created
      },
    }
    await composeFrame({ ...frame, layers: [layer()] }, async () => stored, watching)
    expect(seen).toEqual([true, 'high'])
  })

  describe('decoding size', () => {
    function decodeCalls(): { calls: unknown[][]; raster: Raster } {
      const calls: unknown[][] = []
      const base = fakeRaster([])
      return {
        calls,
        raster: {
          createCanvas: base.createCanvas,
          decode: (blob, resizeWidth) => {
            calls.push([resizeWidth])
            return base.decode(blob)
          },
        },
      }
    }

    it('decodes at the drawn width when that is smaller than the photo', async () => {
      const { calls, raster } = decodeCalls()
      const halfWidth = { ...frame, layers: [layer({ widthFrac: 0.5 })] }
      await composeFrame(halfWidth, async () => stored, raster)
      expect(calls).toEqual([[591]])
    })

    it('rounds the width up, so nothing is lost to the last pixel', async () => {
      const { calls, raster } = decodeCalls()
      const third = { ...frame, layers: [layer({ widthFrac: 0.3333 })] }
      await composeFrame(third, async () => stored, raster)
      expect(calls).toEqual([[394]])
    })

    it('never upscales: a narrower photo is decoded at its own size', async () => {
      const { calls, raster } = decodeCalls()
      const small: StoredPhoto = { ...stored, width: 800, height: 1200 }
      await composeFrame({ ...frame, layers: [layer()] }, async () => small, raster)
      expect(calls).toEqual([[undefined]])
    })

    it('decodes at its own size when the drawn width equals the photo width', async () => {
      const { calls, raster } = decodeCalls()
      const exact: StoredPhoto = { ...stored, width: 1181, height: 1771 }
      await composeFrame({ ...frame, layers: [layer()] }, async () => exact, raster)
      expect(calls).toEqual([[undefined]])
    })
  })
})

describe('browserRaster', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('decode', () => {
    function stubDecoder() {
      const decoder = vi.fn(async () => ({}) as ImageBitmap)
      vi.stubGlobal('createImageBitmap', decoder)
      return decoder
    }

    it('keeps the EXIF orientation at the full size', async () => {
      const decoder = stubDecoder()
      const blob = new Blob(['x'])
      await browserRaster.decode(blob)
      expect(decoder).toHaveBeenCalledWith(blob, { imageOrientation: 'from-image' })
    })

    it('asks for a high quality reduction, still with the EXIF orientation', async () => {
      const decoder = stubDecoder()
      const blob = new Blob(['x'])
      await browserRaster.decode(blob, 1181)
      expect(decoder).toHaveBeenCalledWith(blob, {
        imageOrientation: 'from-image',
        resizeWidth: 1181,
        resizeQuality: 'high',
      })
    })
  })

  describe('without OffscreenCanvas', () => {
    function stubDomCanvas(blob: Blob | null) {
      vi.stubGlobal('OffscreenCanvas', undefined)
      const context = { fillRect() {} } as unknown as CanvasRenderingContext2D
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done, type, quality) => {
        expect([type, quality]).toEqual(['image/jpeg', 0.92])
        done(blob)
      })
      return context
    }

    const createdCanvas = () =>
      vi.mocked(HTMLCanvasElement.prototype.getContext).mock.contexts[0] as HTMLCanvasElement

    it('renders on a DOM canvas of the requested size and exports a JPEG', async () => {
      const context = stubDomCanvas(new Blob([new Uint8Array([9, 8])]))
      const canvas = browserRaster.createCanvas(40, 60)
      expect(canvas.context).toBe(context)
      await expect(canvas.exportJpeg(0.92)).resolves.toEqual(new Uint8Array([9, 8]))
      expect([createdCanvas().width, createdCanvas().height]).toEqual([40, 60])
    })

    it('fails instead of producing nothing when the canvas cannot export', async () => {
      stubDomCanvas(null)
      await expect(browserRaster.createCanvas(40, 60).exportJpeg(0.92)).rejects.toThrow()
    })

    it('frees the backing store on release', () => {
      stubDomCanvas(new Blob(['x']))
      browserRaster.createCanvas(40, 60).release()
      expect([createdCanvas().width, createdCanvas().height]).toEqual([0, 0])
    })
  })

  it('prefers OffscreenCanvas when it exists', async () => {
    const convertToBlob = vi.fn(async () => new Blob([new Uint8Array([7])]))
    const instances: FakeOffscreen[] = []
    class FakeOffscreen {
      width: number
      height: number
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
        instances.push(this)
      }
      getContext = () => ({})
      convertToBlob = convertToBlob
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreen)

    const canvas = browserRaster.createCanvas(10, 20)
    await expect(canvas.exportJpeg(0.92)).resolves.toEqual(new Uint8Array([7]))
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.92 })
    expect([instances[0]!.width, instances[0]!.height]).toEqual([10, 20])
    canvas.release()
    expect([instances[0]!.width, instances[0]!.height]).toEqual([0, 0])
  })
})
