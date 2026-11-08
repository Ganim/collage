import type { Paper } from '../core/types'

export interface PackRequest {
  frames: { id: string; widthMm: number; heightMm: number }[]
  paper: Paper
}

export interface PlacedFrame {
  frameId: string
  xMm: number
  yMm: number
  rotated: boolean
}

export interface SheetLayout {
  sheets: PlacedFrame[][]
  unplaced: string[]
  usedRatio: number
}

interface PackOutput {
  sheets: { placements: { id: string; x: number; y: number; rotated: boolean }[] }[]
  unplaced: string[]
}

const toTenths = (mm: number): number => Math.round(mm * 10)
const toMm = (tenths: number): number => tenths / 10

/** Pure layout step: `packJson` is the wasm entry point (or a stand-in), taking and returning JSON. */
export function solve(request: PackRequest, packJson: (input: string) => string): SheetLayout {
  const { frames, paper } = request
  const input = {
    items: frames.map((f) => ({ id: f.id, w: toTenths(f.widthMm), h: toTenths(f.heightMm) })),
    sheetW: toTenths(paper.widthMm),
    sheetH: toTenths(paper.heightMm),
    margin: toTenths(paper.marginMm),
    gap: toTenths(paper.gapMm),
  }
  const output = JSON.parse(packJson(JSON.stringify(input))) as PackOutput

  const area = new Map(frames.map((f) => [f.id, f.widthMm * f.heightMm]))
  let placedArea = 0
  const sheets = output.sheets.map((sheet) =>
    sheet.placements.map((p) => {
      placedArea += area.get(p.id) ?? 0
      return { frameId: p.id, xMm: toMm(p.x), yMm: toMm(p.y), rotated: p.rotated }
    }),
  )
  const paperArea = paper.widthMm * paper.heightMm * sheets.length
  return {
    sheets,
    unplaced: output.unplaced,
    usedRatio: paperArea === 0 ? 0 : placedArea / paperArea,
  }
}

interface Pending {
  resolve: (layout: SheetLayout) => void
  reject: (reason: unknown) => void
}

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  const created = new Worker(new URL('./pack.worker.ts', import.meta.url), { type: 'module' })
  created.onmessage = (
    event: MessageEvent<{ id: number; layout?: SheetLayout; error?: string }>,
  ) => {
    const { id, layout, error } = event.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (layout) entry.resolve(layout)
    else entry.reject(new Error(error ?? 'packing failed'))
  }
  created.onerror = (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message))
    pending.clear()
    worker = undefined
  }
  worker = created
  return created
}

/** Lays frames out on sheets in a Web Worker; replies are matched to calls by id. */
export function packFrames(request: PackRequest): Promise<SheetLayout> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, request })
  })
}
