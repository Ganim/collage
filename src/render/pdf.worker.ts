import { createIdbStore } from '../storage/indexeddb'
import type { Store } from '../storage/store'
import { MissingPhotoError } from './compose'
import type { PdfWorkerReply } from './generate'
import { generatePdfWith, type GenerateRequest } from './pdf'

let store: Promise<Store> | undefined

function getStore(): Promise<Store> {
  store ??= createIdbStore().catch((error: unknown) => {
    store = undefined
    throw error
  })
  return store
}

const reply = (message: PdfWorkerReply): void => self.postMessage(message)

async function run({ id, req }: { id: number; req: GenerateRequest }): Promise<void> {
  try {
    const pdf = await generatePdfWith(await getStore(), req, (done, total) =>
      reply({ id, progress: { done, total } }),
    )
    reply({ id, pdf })
  } catch (error) {
    reply({
      id,
      error: error instanceof Error ? error.message : String(error),
      missingFrameIds: error instanceof MissingPhotoError ? error.frameIds : undefined,
    })
  }
}

// One at a time: two generations side by side would hold two sets of full-size canvases.
let queue: Promise<void> = Promise.resolve()

self.onmessage = (event: MessageEvent<{ id: number; req: GenerateRequest }>) => {
  const message = event.data
  queue = queue.then(() => run(message))
}
