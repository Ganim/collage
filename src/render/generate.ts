import { MissingPhotoError } from './compose'
import type { GenerateRequest } from './pdf'

export { MissingPhotoError }

export type PdfWorkerReply =
  | { id: number; progress: { done: number; total: number } }
  | { id: number; pdf: Blob }
  | { id: number; error: string; missingFrameIds?: string[] }

interface Pending {
  resolve: (pdf: Blob) => void
  reject: (reason: unknown) => void
  onProgress: (done: number, total: number) => void
}

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, Pending>()

function failAll(message: string): void {
  const error = new Error(message || 'pdf worker failed')
  for (const entry of pending.values()) entry.reject(error)
  pending.clear()
  worker?.terminate()
  worker = undefined
}

function handleReply(reply: PdfWorkerReply): void {
  const entry = pending.get(reply.id)
  if (!entry) return
  if ('progress' in reply) {
    entry.onProgress(reply.progress.done, reply.progress.total)
    return
  }
  pending.delete(reply.id)
  if ('pdf' in reply) entry.resolve(reply.pdf)
  else if (reply.missingFrameIds) entry.reject(new MissingPhotoError(reply.missingFrameIds))
  else entry.reject(new Error(reply.error || 'pdf generation failed'))
}

function getWorker(): Worker {
  if (worker) return worker
  const created = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' })
  created.onmessage = (event: MessageEvent<PdfWorkerReply>) => handleReply(event.data)
  created.onerror = (event) => failAll(event.message || 'pdf worker failed to load')
  created.onmessageerror = () => failAll('pdf worker sent an unreadable message')
  worker = created
  return created
}

/** Builds the PDF in a Web Worker; replies are matched to calls by id. */
export function generatePdf(
  req: GenerateRequest,
  onProgress: (done: number, total: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const target = getWorker()
    const id = nextId++
    pending.set(id, { resolve, reject, onProgress })
    target.postMessage({ id, req })
  })
}
