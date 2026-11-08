import { solve, type PackRequest } from './pack'
import init, { pack_json } from './wasm/packing'

const ready = init()

self.onmessage = async (event: MessageEvent<{ id: number; request: PackRequest }>) => {
  const { id, request } = event.data
  try {
    await ready
    self.postMessage({ id, layout: solve(request, pack_json) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
