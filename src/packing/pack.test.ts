/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initSync, pack_json } from './wasm/packing'
import { betterLayout, solve, type PackRequest, type SheetLayout } from './pack'

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
    expect(layout).toEqual({
      sheets: [],
      unplaced: [],
      usedRatio: 0,
      lastArea: 0,
      lastExtent: 0,
      lowerBound: 0,
    })
  })
})

describe('packFrames', () => {
  const request: PackRequest = { frames: [], paper: A4 }
  const layout = (n: number) => ({
    sheets: [],
    unplaced: [`u${n}`],
    usedRatio: 0,
    lastArea: 0,
    lastExtent: 0,
    lowerBound: 0,
  })

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
    terminated = false
    terminate() {
      this.terminated = true
    }
  }

  async function load() {
    vi.resetModules()
    FakeWorker.instances = []
    FakeWorker.failConstruct = false
    vi.stubGlobal('Worker', FakeWorker)
    return import('./pack')
  }

  afterEach(() => vi.unstubAllGlobals())

  it('reorganizes on a worker of its own, so the normal layout never waits behind it', async () => {
    const { packFrames, reorganizeFrames } = await load()
    const slow = reorganizeFrames(request)
    const quick = packFrames(request)
    expect(FakeWorker.instances).toHaveLength(2)
    const [own, shared] = FakeWorker.instances as [FakeWorker, FakeWorker]
    expect(own.posted).toHaveLength(1)
    expect(shared.posted).toHaveLength(1)
    shared.onmessage?.({ data: { id: shared.posted[0]!.id, layout: layout(1) } })
    expect((await quick).unplaced).toEqual(['u1'])
    own.onmessage?.({ data: { id: own.posted[0]!.id, layout: layout(2) } })
    expect((await slow.result).unplaced).toEqual(['u2'])
    expect(own.terminated).toBe(true)
    expect(shared.terminated).toBe(false)
  })

  it('cancelling a reorganize stops its worker and rejects with PackCancelled', async () => {
    const { reorganizeFrames, PackCancelled } = await load()
    const running = reorganizeFrames(request)
    running.cancel()
    expect(FakeWorker.instances[0]!.terminated).toBe(true)
    await expect(running.result).rejects.toBeInstanceOf(PackCancelled)
    running.cancel()
  })

  it('a reorganize worker that fails is stopped and rejects', async () => {
    const { reorganizeFrames } = await load()
    const running = reorganizeFrames(request)
    FakeWorker.instances[0]!.onerror?.({ message: '' })
    await expect(running.result).rejects.toSatisfy((e: Error) => e.message.length > 0)
    expect(FakeWorker.instances[0]!.terminated).toBe(true)
  })

  it('a reorganize worker that cannot start rejects', async () => {
    const { reorganizeFrames } = await load()
    FakeWorker.failConstruct = true
    await expect(reorganizeFrames(request).result).rejects.toThrow('boom')
  })

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

describe('solve options and ranking', () => {
  const one = (input: string): string => {
    seen.push(JSON.parse(input) as Record<string, unknown>)
    return JSON.stringify({
      sheets: [{ placements: [{ id: 'a', x: 50, y: 50, rotated: false }] }],
      unplaced: [],
      lastArea: 7,
      lastExtent: 9,
      lowerBound: 1,
    })
  }
  let seen: Record<string, unknown>[] = []
  const frames = [{ id: 'a', widthMm: 100, heightMm: 150 }]

  it('passes seed and effort to the packer only when given', () => {
    seen = []
    solve({ frames, paper: A4 }, one)
    solve({ frames, paper: A4, seed: 12345, effort: 16 }, one)
    expect(seen[0]).not.toHaveProperty('seed')
    expect(seen[0]).not.toHaveProperty('effort')
    expect(seen[1]).toMatchObject({ seed: 12345, effort: 16 })
  })

  it('keeps the rank of the last sheet', () => {
    const layout = solve({ frames, paper: A4 }, one)
    expect(layout.lastArea).toBe(7)
    expect(layout.lastExtent).toBe(9)
    expect(layout.lowerBound).toBe(1)
  })

  it('ranks fewer sheets first, then less area and a smaller extent on the last sheet', () => {
    const of = (sheets: number, lastArea: number, lastExtent: number): SheetLayout => ({
      sheets: Array.from({ length: sheets }, () => []),
      unplaced: [],
      usedRatio: 0,
      lastArea,
      lastExtent,
      lowerBound: 1,
    })
    expect(betterLayout(of(1, 9, 9), of(2, 1, 1))).toBe(true)
    expect(betterLayout(of(2, 1, 9), of(2, 2, 1))).toBe(true)
    expect(betterLayout(of(2, 2, 1), of(2, 2, 2))).toBe(true)
    expect(betterLayout(of(2, 2, 2), of(2, 2, 2))).toBe(false)
    expect(betterLayout(of(3, 0, 0), of(2, 9, 9))).toBe(false)
  })

  it('fits four 9x12 cm on one A4 with 5 mm spacing by turning them all', () => {
    const paper = { widthMm: 210, heightMm: 297, marginMm: 5, gapMm: 5 }
    const frames = ['a', 'b', 'c', 'd'].map((id) => ({ id, widthMm: 120, heightMm: 90 }))
    const layout = solve({ frames, paper }, pack_json)
    expect(layout.sheets).toHaveLength(1)
    expect(layout.sheets[0]!.every((p) => p.rotated)).toBe(true)
    const again = solve({ frames, paper, seed: 99, effort: 4 }, pack_json)
    expect(again.sheets).toHaveLength(1)
  })
})
