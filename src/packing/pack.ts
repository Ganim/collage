import type { Paper } from '../core/types'

export interface PackRequest {
  frames: { id: string; widthMm: number; heightMm: number }[]
  paper: Paper
  /** Seed for the packer's shuffled orders; the default seed when absent. */
  seed?: number
  /** Multiplies the packer's search; 1 when absent. */
  effort?: number
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
  /** Area used on the last sheet, in the packer's units; ranks layouts of equal length. */
  lastArea: number
  /** Bounding-box area of the last sheet's frames; the final tie-break. */
  lastExtent: number
  /** Fewest sheets the frames' area allows: a layout this short cannot be improved. */
  lowerBound: number
}

interface PackOutput {
  sheets: { placements: { id: string; x: number; y: number; rotated: boolean }[] }[]
  unplaced: string[]
  lastArea: number
  lastExtent: number
  lowerBound: number
}

/** True when `a` beats `b`: fewer sheets, then a lighter last sheet, then a tighter one. */
export function betterLayout(a: SheetLayout, b: SheetLayout): boolean {
  if (a.sheets.length !== b.sheets.length) return a.sheets.length < b.sheets.length
  if (a.lastArea !== b.lastArea) return a.lastArea < b.lastArea
  return a.lastExtent < b.lastExtent
}

const toTenths = (mm: number): number => Math.round(mm * 10)
const toMm = (tenths: number): number => tenths / 10

/** Pure layout step: `packJson` is the wasm entry point (or a stand-in), taking and returning JSON. */
export function solve(request: PackRequest, packJson: (input: string) => string): SheetLayout {
  const { frames, paper, seed, effort } = request
  const input = {
    items: frames.map((f) => ({ id: f.id, w: toTenths(f.widthMm), h: toTenths(f.heightMm) })),
    sheetW: toTenths(paper.widthMm),
    sheetH: toTenths(paper.heightMm),
    margin: toTenths(paper.marginMm),
    gap: toTenths(paper.gapMm),
    seed,
    effort,
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
    lastArea: output.lastArea,
    lastExtent: output.lastExtent,
    lowerBound: output.lowerBound,
  }
}

interface Pending {
  resolve: (layout: SheetLayout) => void
  reject: (reason: unknown) => void
}

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, Pending>()

function failAll(message: string): void {
  const error = new Error(message || 'packing worker failed')
  for (const entry of pending.values()) entry.reject(error)
  pending.clear()
  worker?.terminate()
  worker = undefined
}

const startWorker = (): Worker =>
  new Worker(new URL('./pack.worker.ts', import.meta.url), { type: 'module' })

function getWorker(): Worker {
  if (worker) return worker
  const created = startWorker()
  created.onmessage = (
    event: MessageEvent<{ id: number; layout?: SheetLayout; error?: string }>,
  ) => {
    const { id, layout, error } = event.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (layout) entry.resolve(layout)
    else entry.reject(new Error(error || 'packing failed'))
  }
  created.onerror = (event) => failAll(event.message || 'packing worker failed to load')
  created.onmessageerror = () => failAll('packing worker sent an unreadable message')
  worker = created
  return created
}

/** Lays frames out on sheets in a Web Worker; replies are matched to calls by id. */
export function packFrames(request: PackRequest): Promise<SheetLayout> {
  return new Promise((resolve, reject) => {
    const target = getWorker()
    const id = nextId++
    pending.set(id, { resolve, reject })
    target.postMessage({ id, request })
  })
}

/** The reason a cancelled reorganize rejects with. */
export class PackCancelled extends Error {
  constructor() {
    super('packing cancelled')
    this.name = 'PackCancelled'
  }
}

export interface PackRun {
  result: Promise<SheetLayout>
  /** Stops the worker; `result` then rejects with PackCancelled, unless it already settled. */
  cancel: () => void
}

/**
 * Lays frames out on a worker of its own, which ends with the reply: a long search here
 * never delays `packFrames`, and cancelling it frees the CPU at once.
 */
export function reorganizeFrames(request: PackRequest): PackRun {
  let own: Worker | undefined
  let settle: ((outcome: { layout?: SheetLayout; error?: unknown }) => void) | undefined
  const result = new Promise<SheetLayout>((resolve, reject) => {
    settle = ({ layout, error }) => {
      settle = undefined
      own?.terminate()
      if (layout) resolve(layout)
      else reject(error instanceof Error ? error : new Error('packing failed'))
    }
    own = startWorker()
    own.onmessage = (event: MessageEvent<{ layout?: SheetLayout; error?: string }>) => {
      const { layout, error } = event.data
      settle?.(layout ? { layout } : { error: new Error(error || 'packing failed') })
    }
    own.onerror = (event) =>
      settle?.({ error: new Error(event.message || 'packing worker failed to load') })
    own.onmessageerror = () =>
      settle?.({ error: new Error('packing worker sent an unreadable message') })
    own.postMessage({ id: 0, request })
  })
  return { result, cancel: () => settle?.({ error: new PackCancelled() }) }
}
