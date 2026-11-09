// @vitest-environment node
import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Collection, Frame, Layer } from '../core/types'
import type { SheetLayout } from '../packing/pack'
import type { Store, StoredPhoto } from '../storage/store'
import { MissingPhotoError, type Raster } from './compose'
import { generatePdfWith } from './pdf'

const JPEG = [
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x11, 0x00, 0x02,
  0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
]

function layer(photoId: string): Layer {
  return { id: `l-${photoId}`, photoId, cx: 0.5, cy: 0.5, widthFrac: 1, rotationDeg: 0 }
}

function frame(id: string, ...photoIds: string[]): Frame {
  return { id, widthMm: 100, heightMm: 150, layers: photoIds.map(layer) }
}

function collectionOf(...frames: Frame[]): Collection {
  return {
    schemaVersion: 1,
    id: 'c',
    name: 'c',
    photoIds: [],
    frames,
    paper: { widthMm: 210, heightMm: 297, marginMm: 5, gapMm: 2 },
    updatedAt: 0,
  }
}

function layoutOf(...frameIds: string[]): SheetLayout {
  return {
    sheets: [frameIds.map((frameId) => ({ frameId, xMm: 5, yMm: 5, rotated: false }))],
    unplaced: [],
    usedRatio: 0,
  }
}

function storeWith(...ids: string[]): Store {
  const photo = (id: string): StoredPhoto => ({
    id,
    width: 2,
    height: 3,
    name: id,
    original: new Blob([`original-${id}`]),
    preview: new Blob([`preview-${id}`]),
    thumb: new Blob([`thumb-${id}`]),
  })
  return {
    getPhoto: async (id: string) => (ids.includes(id) ? photo(id) : undefined),
    getPhotosMeta: async (wanted: string[]) =>
      Object.fromEntries(wanted.filter((id) => ids.includes(id)).map((id) => [id, photo(id)])),
  } as unknown as Store
}

function fakeRaster(decoded: Blob[] = []) {
  return {
    decode: async (blob: Blob) => {
      decoded.push(blob)
      return { close() {} } as unknown as ImageBitmap
    },
    createCanvas: vi.fn<Raster['createCanvas']>(() => ({
      context: {
        fillRect() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        drawImage() {},
      } as unknown as ReturnType<Raster['createCanvas']>['context'],
      exportJpeg: async () => Uint8Array.from(JPEG),
      release() {},
    })),
  }
}

describe('generatePdfWith', () => {
  it('rejects with every affected frame before rendering anything', async () => {
    const raster = fakeRaster()
    const collection = collectionOf(frame('ok', 'p1'), frame('a', 'gone'), frame('b', 'p1', 'gone'))
    const error = await generatePdfWith(
      storeWith('p1'),
      { collection, layout: layoutOf('ok', 'a', 'b') },
      () => {},
      raster,
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(MissingPhotoError)
    expect((error as MissingPhotoError).frameIds).toEqual(['a', 'b'])
    expect(raster.createCanvas).not.toHaveBeenCalled()
  })

  it('rejects with MissingPhotoError if a photo vanishes during rendering', async () => {
    const store = storeWith('p1')
    const collection = collectionOf(frame('a', 'p1'))
    store.getPhoto = async () => undefined
    const error = await generatePdfWith(
      store,
      { collection, layout: layoutOf('a') },
      () => {},
      fakeRaster(),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MissingPhotoError)
    expect((error as MissingPhotoError).frameIds).toEqual(['a'])
  })

  it('ignores missing photos on frames that were not placed', async () => {
    const collection = collectionOf(frame('placed', 'p1'), frame('left-out', 'gone'))
    const blob = await generatePdfWith(
      storeWith('p1'),
      { collection, layout: layoutOf('placed') },
      () => {},
      fakeRaster(),
    )
    expect(blob.size).toBeGreaterThan(0)
  })

  it('rejects when the layout names a frame the collection lacks', async () => {
    await expect(
      generatePdfWith(
        storeWith(),
        { collection: collectionOf(), layout: layoutOf('ghost') },
        () => {},
        fakeRaster(),
      ),
    ).rejects.toThrow('ghost')
  })

  it('composes from the originals and reports progress per frame', async () => {
    const decoded: Blob[] = []
    const progress: [number, number][] = []
    const collection = collectionOf(frame('a', 'p1'), frame('b', 'p2'))
    const blob = await generatePdfWith(
      storeWith('p1', 'p2'),
      { collection, layout: layoutOf('a', 'b') },
      (done, total) => progress.push([done, total]),
      fakeRaster(decoded),
    )

    expect(await Promise.all(decoded.map((b) => b.text()))).toEqual(['original-p1', 'original-p2'])
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
    expect(blob.type).toBe('application/pdf')
    const doc = await PDFDocument.load(await blob.arrayBuffer())
    expect(doc.getPageCount()).toBe(1)
  })
})

describe('generatePdf', () => {
  const req = { collection: collectionOf(), layout: layoutOf() }

  class FakeWorker {
    static instances: FakeWorker[] = []
    static failConstruct = false
    static failPost = false
    posted: { id: number }[] = []
    terminated = false
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: ((e: { message: string }) => void) | null = null
    onmessageerror: (() => void) | null = null
    constructor() {
      if (FakeWorker.failConstruct) throw new Error('boom')
      FakeWorker.instances.push(this)
    }
    postMessage(msg: { id: number }) {
      this.posted.push(msg)
      if (FakeWorker.failPost) throw new DOMException('cannot clone', 'DataCloneError')
    }
    terminate() {
      this.terminated = true
    }
  }

  async function load() {
    vi.resetModules()
    FakeWorker.instances = []
    FakeWorker.failConstruct = false
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('OffscreenCanvas', class {})
    return import('./generate')
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWorker.failPost = false
  })

  it('forgets the call when postMessage throws', async () => {
    const { generatePdf } = await load()
    FakeWorker.failPost = true
    const progress = vi.fn()
    await expect(generatePdf(req, progress)).rejects.toThrow('cannot clone')
    FakeWorker.failPost = false

    const w = FakeWorker.instances[0]!
    w.onmessage?.({ data: { id: w.posted[0]!.id, progress: { done: 1, total: 1 } } })
    expect(progress).not.toHaveBeenCalled()
  })

  it('matches progress and results to calls by id and reuses one worker', async () => {
    const { generatePdf } = await load()
    const progressA: number[] = []
    const progressB: number[] = []
    const first = generatePdf(req, (done) => progressA.push(done))
    const second = generatePdf(req, (done) => progressB.push(done))
    expect(FakeWorker.instances).toHaveLength(1)
    const w = FakeWorker.instances[0]!
    const [a, b] = w.posted.map((m) => m.id)
    const pdfA = new Blob(['a'])
    const pdfB = new Blob(['b'])

    w.onmessage?.({ data: { id: b, progress: { done: 2, total: 3 } } })
    w.onmessage?.({ data: { id: a, progress: { done: 1, total: 3 } } })
    w.onmessage?.({ data: { id: b, pdf: pdfB } })
    w.onmessage?.({ data: { id: a, pdf: pdfA } })

    expect(await first).toBe(pdfA)
    expect(await second).toBe(pdfB)
    expect(progressA).toEqual([1])
    expect(progressB).toEqual([2])
  })

  it('rebuilds MissingPhotoError across the worker boundary', async () => {
    const generate = await load()
    const call = generate.generatePdf(req, () => {})
    const w = FakeWorker.instances[0]!
    w.onmessage?.({ data: { id: w.posted[0]!.id, error: 'x', missingFrameIds: ['a', 'b'] } })
    const error = await call.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(generate.MissingPhotoError)
    expect((error as MissingPhotoError).frameIds).toEqual(['a', 'b'])
  })

  it('rejects with the reported message on a generation failure', async () => {
    const { generatePdf } = await load()
    const call = generatePdf(req, () => {})
    const w = FakeWorker.instances[0]!
    w.onmessage?.({ data: { id: w.posted[0]!.id, error: 'decode failed' } })
    await expect(call).rejects.toThrow('decode failed')
  })

  it('rejects every pending call on a worker error and starts a new worker next time', async () => {
    const { generatePdf } = await load()
    const calls = [generatePdf(req, () => {}), generatePdf(req, () => {})]
    const w = FakeWorker.instances[0]!
    w.onerror?.({ message: '' })
    for (const call of calls) {
      await expect(call).rejects.toSatisfy((e: Error) => e.message.length > 0)
    }
    expect(w.terminated).toBe(true)
    void generatePdf(req, () => {}).catch(() => {})
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('rejects pending calls on an unreadable message', async () => {
    const { generatePdf } = await load()
    const call = generatePdf(req, () => {})
    FakeWorker.instances[0]!.onmessageerror?.()
    await expect(call).rejects.toSatisfy((e: Error) => e.message.length > 0)
  })

  it('rejects when the Worker constructor throws and recovers afterwards', async () => {
    const { generatePdf } = await load()
    FakeWorker.failConstruct = true
    await expect(generatePdf(req, () => {})).rejects.toThrow('boom')
    FakeWorker.failConstruct = false
    const retry = generatePdf(req, () => {})
    const w = FakeWorker.instances[0]!
    const pdf = new Blob(['p'])
    w.onmessage?.({ data: { id: w.posted[0]!.id, pdf } })
    expect(await retry).toBe(pdf)
  })
})

const { mockGeneratePdf, createIdbStore } = vi.hoisted(() => ({
  mockGeneratePdf: vi.fn(),
  createIdbStore: vi.fn(),
}))

describe('generatePdf without OffscreenCanvas', () => {
  const req = { collection: collectionOf(), layout: layoutOf() }

  async function load() {
    vi.resetModules()
    vi.doMock('./pdf', () => ({ generatePdfWith: mockGeneratePdf }))
    vi.doMock('../storage/indexeddb', () => ({ createIdbStore }))
    createIdbStore.mockReset()
    createIdbStore.mockResolvedValue({ store: true })
    mockGeneratePdf.mockReset()
    return import('./generate')
  }

  afterEach(() => {
    vi.doUnmock('./pdf')
    vi.doUnmock('../storage/indexeddb')
    vi.unstubAllGlobals()
  })

  it('runs on the main thread, with no worker, and relays progress', async () => {
    const worker = vi.fn()
    vi.stubGlobal('Worker', worker)
    const { generatePdf } = await load()
    const pdf = new Blob(['p'])
    mockGeneratePdf.mockImplementation(async (_store, _req, onProgress) => {
      onProgress(1, 1)
      return pdf
    })
    const progress = vi.fn()

    await expect(generatePdf(req, progress)).resolves.toBe(pdf)

    expect(worker).not.toHaveBeenCalled()
    expect(mockGeneratePdf.mock.calls[0]![0]).toEqual({ store: true })
    expect(mockGeneratePdf.mock.calls[0]![1]).toBe(req)
    expect(progress).toHaveBeenCalledWith(1, 1)
  })

  it('runs one generation at a time and survives a failure', async () => {
    const { generatePdf } = await load()
    let finishFirst!: (error: Error) => void
    mockGeneratePdf.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (finishFirst = reject)),
    )
    const pdf = new Blob(['second'])
    mockGeneratePdf.mockResolvedValueOnce(pdf)

    const first = generatePdf(req, () => {})
    const second = generatePdf(req, () => {})
    await vi.waitFor(() => expect(mockGeneratePdf).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockGeneratePdf).toHaveBeenCalledTimes(1)

    finishFirst(new Error('decode failed'))
    await expect(first).rejects.toThrow('decode failed')
    await expect(second).resolves.toBe(pdf)
  })

  it('keeps MissingPhotoError so the screen can tell it apart', async () => {
    const generate = await load()
    mockGeneratePdf.mockRejectedValue(new generate.MissingPhotoError(['a']))
    await expect(generate.generatePdf(req, () => {})).rejects.toBeInstanceOf(
      generate.MissingPhotoError,
    )
  })

  it('tries the storage again after it could not be opened', async () => {
    const { generatePdf } = await load()
    createIdbStore.mockRejectedValueOnce(new Error('blocked'))
    const pdf = new Blob(['p'])
    mockGeneratePdf.mockResolvedValue(pdf)
    await expect(generatePdf(req, () => {})).rejects.toThrow('blocked')
    await expect(generatePdf(req, () => {})).resolves.toBe(pdf)
  })
})
