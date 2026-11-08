import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeImage } from './import'

describe('decodeImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses a plain canvas where OffscreenCanvas does not exist', async () => {
    const close = vi.fn()
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 3200, height: 1600, close })),
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(new Blob([`${this.width}x${this.height}`], { type: 'image/jpeg' }))
    })

    const decoded = await decodeImage(new File(['x'], 'a.jpg'))

    expect(decoded).toMatchObject({ width: 3200, height: 1600 })
    expect(decoded.preview.size).toBe('1600x800'.length)
    expect(decoded.thumb.size).toBe('256x128'.length)
    expect(close).toHaveBeenCalledOnce()
  })
})
