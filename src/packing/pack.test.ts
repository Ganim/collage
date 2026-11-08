import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
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
