import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Frame, Paper } from '../../core/types'
import { packFrames, type PackRequest, type SheetLayout } from '../../packing/pack'
import { REORGANIZE_EFFORT, useSheetLayout } from './useSheetLayout'

vi.mock('../../packing/pack', async (original) => ({
  ...(await original<typeof import('../../packing/pack')>()),
  packFrames: vi.fn(),
}))

const layer = { id: 'l', photoId: 'p', cx: 0.5, cy: 0.5, widthFrac: 1, rotationDeg: 0 }
const filled: Frame = { id: 'a', widthMm: 100, heightMm: 150, layers: [layer] }
const empty: Frame = { id: 'b', widthMm: 100, heightMm: 150, layers: [] }
const a4: Paper = { widthMm: 210, heightMm: 297, marginMm: 5, gapMm: 3 }
const a3: Paper = { ...a4, widthMm: 297, heightMm: 420 }

const layoutOf = (usedRatio: number, sheets = 1, lastArea = 0): SheetLayout => ({
  sheets: Array.from({ length: sheets }, () => []),
  unplaced: [],
  usedRatio,
  lastArea,
  lastExtent: 0,
})

interface Deferred {
  request: PackRequest
  resolve(layout: SheetLayout): void
  reject(error: unknown): void
}

describe('useSheetLayout', () => {
  let calls: Deferred[]

  beforeEach(() => {
    vi.useFakeTimers()
    calls = []
    vi.mocked(packFrames).mockReset()
    vi.mocked(packFrames).mockImplementation(
      (request) =>
        new Promise((resolve, reject) => {
          calls.push({ request, resolve, reject })
        }),
    )
  })

  afterEach(() => vi.useRealTimers())

  const elapse = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
  const settle = (call: Deferred, layout: SheetLayout) =>
    act(async () => {
      call.resolve(layout)
      await vi.advanceTimersByTimeAsync(0)
    })
  const setup = (paper = a4) =>
    renderHook((p: Paper) => useSheetLayout([filled, empty], p), { initialProps: paper })

  it('packs only frames with photos, after 200 ms', async () => {
    setup()
    await elapse(199)
    expect(packFrames).not.toHaveBeenCalled()
    await elapse(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.request).toEqual({
      frames: [{ id: 'a', widthMm: 100, heightMm: 150 }],
      paper: a4,
    })
  })

  it('packs once for a burst of changes', async () => {
    const { rerender } = setup()
    await elapse(100)
    rerender(a3)
    await elapse(100)
    rerender({ ...a3, marginMm: 7 })
    await elapse(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.request.paper.marginMm).toBe(7)
  })

  it('reports the layout with the paper it was computed for', async () => {
    const { result } = setup()
    expect(result.current.current).toBe(false)
    expect(result.current.layout).toBeNull()
    await elapse(200)
    const layout = layoutOf(0.5)
    await settle(calls[0]!, layout)
    expect(result.current.layout).toBe(layout)
    expect(result.current.paper).toEqual(a4)
    expect(result.current.current).toBe(true)
  })

  it('stops being current as soon as the paper changes, keeping the old layout on show', async () => {
    const { result, rerender } = setup()
    await elapse(200)
    const layout = layoutOf(0.5)
    await settle(calls[0]!, layout)

    rerender(a3)
    expect(result.current.current).toBe(false)
    expect(result.current.layout).toBe(layout)
    expect(result.current.paper).toEqual(a4)
  })

  it('ignores a result that arrives after a newer request started', async () => {
    const { result, rerender } = setup()
    await elapse(200)
    rerender(a3)
    await elapse(200)
    expect(calls).toHaveLength(2)

    const newest = layoutOf(0.9)
    await settle(calls[1]!, newest)
    await settle(calls[0]!, layoutOf(0.1))

    expect(result.current.layout).toBe(newest)
    expect(result.current.paper).toEqual(a3)
    expect(result.current.current).toBe(true)
  })

  it('reports a failed layout, and recovers on the next change', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, rerender } = setup()
    await elapse(200)
    await act(async () => {
      calls[0]!.reject(new Error('wasm'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.failed).toBe(true)
    expect(result.current.current).toBe(false)

    rerender(a3)
    await elapse(200)
    await settle(calls[1]!, layoutOf(0.2))
    expect(result.current.failed).toBe(false)
    expect(result.current.current).toBe(true)
    spy.mockRestore()
  })

  describe('reorganize', () => {
    const shown = async (layout: SheetLayout) => {
      const hook = setup()
      await elapse(200)
      await settle(calls[0]!, layout)
      return hook
    }

    it('packs the same frames and paper again with a high effort and a fresh seed', async () => {
      const { result } = await shown(layoutOf(0.5, 2))
      act(() => result.current.reorganize())
      act(() => result.current.reorganize())
      expect(calls).toHaveLength(2)
      expect(result.current.reorganizing).toBe(true)
      const { seed, effort, ...rest } = calls[1]!.request
      expect(rest).toEqual(calls[0]!.request)
      expect(effort).toBe(REORGANIZE_EFFORT)
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThan(2 ** 32)
    })

    it('shows the new layout when it uses fewer sheets', async () => {
      const { result } = await shown(layoutOf(0.5, 3))
      act(() => result.current.reorganize())
      const better = layoutOf(0.7, 2)
      await settle(calls[1]!, better)
      expect(result.current.layout).toBe(better)
      expect(result.current.current).toBe(true)
      expect(result.current.reorganizing).toBe(false)
      expect(result.current.reorganized).toEqual({ reduced: true, sheets: 2 })
    })

    it('takes a tighter last sheet but reports no reduction', async () => {
      const { result } = await shown(layoutOf(0.5, 2, 100))
      act(() => result.current.reorganize())
      const tighter = layoutOf(0.5, 2, 50)
      await settle(calls[1]!, tighter)
      expect(result.current.layout).toBe(tighter)
      expect(result.current.reorganized).toEqual({ reduced: false, sheets: 2 })
    })

    it('keeps the layout on show when the new one is not better', async () => {
      const first = layoutOf(0.5, 2, 100)
      const { result } = await shown(first)
      act(() => result.current.reorganize())
      await settle(calls[1]!, layoutOf(0.5, 3, 10))
      expect(result.current.layout).toBe(first)
      expect(result.current.reorganized).toEqual({ reduced: false, sheets: 2 })
      act(() => result.current.reorganize())
      await settle(calls[2]!, layoutOf(0.5, 2, 100))
      expect(result.current.layout).toBe(first)
    })

    it('drops a result that arrives after the paper changed, and the message with it', async () => {
      const { result, rerender } = await shown(layoutOf(0.5, 3))
      act(() => result.current.reorganize())
      rerender(a3)
      await settle(calls[1]!, layoutOf(0.5, 1))
      expect(result.current.layout?.sheets).toHaveLength(3)
      expect(result.current.reorganized).toBeNull()
      expect(result.current.reorganizing).toBe(false)
      await elapse(200)
      const fresh = layoutOf(0.6, 2)
      await settle(calls[2]!, fresh)
      expect(calls[2]!.request.effort).toBeUndefined()
      expect(result.current.layout).toBe(fresh)
      expect(result.current.reorganized).toBeNull()
    })

    it('goes back to the default layout when the paper changes after a reorganize', async () => {
      const { result, rerender } = await shown(layoutOf(0.5, 3))
      act(() => result.current.reorganize())
      await settle(calls[1]!, layoutOf(0.5, 2))
      expect(result.current.reorganized).not.toBeNull()
      rerender(a3)
      expect(result.current.reorganized).toBeNull()
      rerender(a4)
      await elapse(200)
      expect(calls).toHaveLength(3)
      expect(calls[2]!.request.seed).toBeUndefined()
      const plain = layoutOf(0.5, 3)
      await settle(calls[2]!, plain)
      expect(result.current.layout).toBe(plain)
      expect(result.current.reorganized).toBeNull()
    })

    it('does nothing before a current layout exists', async () => {
      const { result } = setup()
      act(() => result.current.reorganize())
      expect(calls).toHaveLength(0)
      expect(result.current.reorganizing).toBe(false)
    })

    it('stops reorganizing when the worker fails', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const first = layoutOf(0.5, 3)
      const { result } = await shown(first)
      act(() => result.current.reorganize())
      await act(async () => {
        calls[1]!.reject(new Error('wasm'))
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.reorganizing).toBe(false)
      expect(result.current.reorganized).toBeNull()
      expect(result.current.layout).toBe(first)
      expect(result.current.failed).toBe(false)
      spy.mockRestore()
    })
  })
})
