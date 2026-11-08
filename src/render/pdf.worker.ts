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

self.onmessage = async (event: MessageEvent<{ id: number; req: GenerateRequest }>) => {
  const { id, req } = event.data
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
