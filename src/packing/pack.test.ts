/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initSync, pack_json } from './wasm/packing'
import { solve, type PackRequest } from './pack'

const A4 = { widthMm: 210, heightMm: 297, marginMm: 5, gapMm: 2 }

beforeAll(() => {
  initSync({ module: readFileSync(resolve(process.cwd(), 'src/packing/wasm/packing_bg.wasm')) })
})

describe('solve', () => {
  it('places two 100x150 frames on one A4 sheet inside the margin', () => {
    const request: PackRequest = {
      frames: [
        { id: 'a', widthMm: 100, heightMm: 150 },
        { id: 'b', widthMm: 100, heightMm: 150 },
      ],
      paper: A4,
    }
    const layout = solve(request, pack_json)
    expect(layout.sheets).toHaveLength(1)
    expect(layout.unplaced).toEqual([])
    expect(layout.sheets[0]?.[0]?.xMm).toBe(5)
    expect(layout.usedRatio).toBeCloseTo((2 * 150 * 100) / (210 * 297), 3)
  })

  it('reports frames that do not fit the paper', () => {
    const layout = solve(
      { frames: [{ id: 'big', widthMm: 400, heightMm: 500 }], paper: A4 },
      pack_json,
    )
    expect(layout.sheets).toEqual([])
    expect(layout.unplaced).toEqual(['big'])
    expect(layout.usedRatio).toBe(0)
  })

  it('returns an empty layout for no frames', () => {
    const layout = solve({ frames: [], paper: A4 }, pack_json)
    expect(layout).toEqual({ sheets: [], unplaced: [], usedRatio: 0 })
  })
})

describe('packFrames', () => {
  const request: PackRequest = { frames: [], paper: A4 }
  const layout = (n: number) => ({ sheets: [], unplaced: [`u${n}`], usedRatio: 0 })

  class FakeWorker {
    static instances: FakeWorker[] = []
    static failConstruct = false
    posted: { id: number }[] = []
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: ((e: { message: string }) => void) | null = null
    onmessageerror: (() => void) | null = null
    constructor() {
      if (FakeWorker.failConstruct) throw new Error('boom')
      FakeWorker.instances.push(this)
    }
    postMessage(msg: { id: number }) {
      this.posted.push(msg)
    }
    terminate() {}
  }

  async function load() {
    vi.resetModules()
    FakeWorker.instances = []
    FakeWorker.failConstruct = false
    vi.stubGlobal('Worker', FakeWorker)
    return import('./pack')
  }

  afterEach(() => vi.unstubAllGlobals())

  it('matches replies to calls by id when they arrive out of order', async () => {
    const { packFrames } = await load()
    const first = packFrames(request)
    const second = packFrames(request)
    const w = FakeWorker.instances[0]!
    const [a, b] = w.posted.map((m) => m.id)
    w.onmessage?.({ data: { id: b, layout: layout(2) } })
    w.onmessage?.({ data: { id: a, layout: layout(1) } })
    expect((await first).unplaced).toEqual(['u1'])
    expect((await second).unplaced).toEqual(['u2'])
  })

  it('rejects every pending call with a non-empty message on worker error', async () => {
    const { packFrames } = await load()
    const calls = [packFrames(request), packFrames(request)]
    FakeWorker.instances[0]!.onerror?.({ message: '' })
    for (const call of calls) {
      await expect(call).rejects.toSatisfy((e: Error) => e.message.length > 0)
    }
  })

  it('rejects when the Worker constructor throws and recovers afterwards', async () => {
    const { packFrames } = await load()
    FakeWorker.failConstruct = true
    await expect(packFrames(request)).rejects.toThrow('boom')
    FakeWorker.failConstruct = false
    const retry = packFrames(request)
    const w = FakeWorker.instances[0]!
    expect(w.posted).toHaveLength(1)
    w.onmessage?.({ data: { id: w.posted[0]!.id, layout: layout(3) } })
    expect((await retry).unplaced).toEqual(['u3'])
  })
})
