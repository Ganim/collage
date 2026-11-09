import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverPdf, pdfFileName } from './deliver'

const pdf = new Blob(['%PDF'], { type: 'application/pdf' })

function stubNavigator(share: (data: ShareData) => Promise<void>, canShare = true) {
  vi.stubGlobal('navigator', { canShare: vi.fn(() => canShare), share: vi.fn(share) })
}

describe('deliverPdf', () => {
  const clicks: { download: string; href: string; connected: boolean }[] = []

  beforeEach(() => {
    clicks.length = 0
    vi.useFakeTimers()
    URL.createObjectURL = vi.fn(() => 'blob:collage')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ download: this.download, href: this.href, connected: this.isConnected })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses the share sheet when the device can share the file', async () => {
    stubNavigator(async () => {})
    await expect(deliverPdf(pdf, 'Maio.pdf')).resolves.toBe('shared')

    const [{ files }] = vi.mocked(navigator.share).mock.calls[0] as [{ files: File[] }]
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toBe('Maio.pdf')
    expect(files[0]!.type).toBe('application/pdf')
    expect(clicks).toHaveLength(0)
  })

  it('asks canShare about the actual file', async () => {
    stubNavigator(async () => {})
    await deliverPdf(pdf, 'Maio.pdf')
    const [data] = vi.mocked(navigator.canShare).mock.calls[0] as [{ files: File[] }]
    expect(data.files[0]!.name).toBe('Maio.pdf')
  })

  it('reports a dismissed share sheet as cancelled and downloads nothing', async () => {
    stubNavigator(async () => {
      throw new DOMException('dismissed', 'AbortError')
    })
    await expect(deliverPdf(pdf, 'Maio.pdf')).resolves.toBe('cancelled')
    expect(clicks).toHaveLength(0)
  })

  it('falls back to a download when sharing fails for another reason', async () => {
    stubNavigator(async () => {
      throw new DOMException('no activation', 'NotAllowedError')
    })
    await expect(deliverPdf(pdf, 'Maio.pdf')).resolves.toBe('downloaded')
    expect(clicks).toEqual([{ download: 'Maio.pdf', href: 'blob:collage', connected: true }])
  })

  it('downloads through an anchor when the device cannot share files', async () => {
    stubNavigator(async () => {}, false)
    await expect(deliverPdf(pdf, 'Maio.pdf')).resolves.toBe('downloaded')
    expect(navigator.share).not.toHaveBeenCalled()
    expect(clicks).toHaveLength(1)
  })

  it('downloads when the browser has no share api at all', async () => {
    vi.stubGlobal('navigator', {})
    await expect(deliverPdf(pdf, 'Maio.pdf')).resolves.toBe('downloaded')
    expect(clicks).toHaveLength(1)
  })

  it('revokes the object url only later, and removes the anchor', async () => {
    stubNavigator(async () => {}, false)
    await deliverPdf(pdf, 'Maio.pdf')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(document.querySelector('a[download]')).toBeNull()
    vi.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:collage')
  })
})

describe('pdfFileName', () => {
  it('uses the collection name', () => {
    expect(pdfFileName('Fotos de maio')).toBe('Fotos de maio.pdf')
  })

  it('removes characters that file names cannot hold', () => {
    expect(pdfFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij.pdf')
    expect(pdfFileName('linha\n\tnova')).toBe('linhanova.pdf')
  })

  it('does not leave leading or trailing dots and spaces', () => {
    expect(pdfFileName('  ..viagem.. ')).toBe('viagem.pdf')
  })

  it('uses a default when nothing usable is left', () => {
    expect(pdfFileName(' /:* ')).toBe('Colagem.pdf')
    expect(pdfFileName('')).toBe('Colagem.pdf')
  })

  it('keeps very long names at a size file systems accept', () => {
    expect(pdfFileName('x'.repeat(500)).length).toBeLessThanOrEqual(124)
  })
})
