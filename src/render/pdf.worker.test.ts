import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerateRequest } from './pdf'

const generatePdfWith = vi.hoisted(() => vi.fn())
vi.mock('./pdf', () => ({ generatePdfWith }))
vi.mock('../storage/indexeddb', () => ({ createIdbStore: async () => ({}) }))

interface FakeSelf {
  onmessage: ((event: { data: { id: number; req: GenerateRequest } }) => void) | null
  postMessage: ReturnType<typeof vi.fn>
}

function deferred() {
  let resolve!: (blob: Blob) => void
  const promise = new Promise<Blob>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const send = (worker: FakeSelf, id: number) =>
  worker.onmessage?.({ data: { id, req: {} as GenerateRequest } })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function loadWorker(): Promise<FakeSelf> {
  vi.resetModules()
  const fake: FakeSelf = { onmessage: null, postMessage: vi.fn() }
  vi.stubGlobal('self', fake)
  await import('./pdf.worker')
  return fake
}

describe('pdf worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    generatePdfWith.mockReset()
  })

  it('runs one generation at a time, in order of arrival', async () => {
    const first = deferred()
    const second = deferred()
    generatePdfWith.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const worker = await loadWorker()

    send(worker, 1)
    send(worker, 2)
    await flush()
    expect(generatePdfWith).toHaveBeenCalledTimes(1)

    const pdf = new Blob(['a'])
    first.resolve(pdf)
    await flush()
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, pdf })
    expect(generatePdfWith).toHaveBeenCalledTimes(2)
  })

  it('keeps going after a failed generation', async () => {
    const pdf = new Blob(['b'])
    generatePdfWith.mockRejectedValueOnce(new Error('decode failed')).mockResolvedValueOnce(pdf)
    const worker = await loadWorker()

    send(worker, 1)
    send(worker, 2)
    await flush()
    await flush()

    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, error: 'decode failed' }),
    )
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 2, pdf })
  })
})
