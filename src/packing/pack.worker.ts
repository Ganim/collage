import { solve, type PackRequest } from './pack'
import init, { pack_json } from './wasm/packing'

let ready: Promise<unknown> | undefined

function ensureReady(): Promise<unknown> {
  ready ??= init().catch((error: unknown) => {
    ready = undefined
    throw error
  })
  return ready
}

self.onmessage = async (event: MessageEvent<{ id: number; request: PackRequest }>) => {
  const { id, request } = event.data
  try {
    await ensureReady()
    self.postMessage({ id, layout: solve(request, pack_json) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
