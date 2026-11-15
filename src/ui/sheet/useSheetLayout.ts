import { useEffect, useRef, useState } from 'react'
import type { Frame, Paper } from '../../core/types'
import { betterLayout, packFrames, type PackRequest, type SheetLayout } from '../../packing/pack'

const PACK_DELAY_MS = 200
/** Search effort of "Reorganizar encaixe": well under two seconds for 60 frames. */
export const REORGANIZE_EFFORT = 16

/** What a reorganize did to the layout on show. */
export interface ReorganizeOutcome {
  /** True when the new layout uses fewer sheets. */
  reduced: boolean
  /** Sheets in the layout on show afterwards. */
  sheets: number
}

/** What the sheet screen shows: the latest layout, with the paper it was computed for. */
export interface SheetLayoutState {
  layout: SheetLayout | null
  paper: Paper | null
  /** True only while the layout matches the current frames and paper. */
  current: boolean
  failed: boolean
  /** True while a reorganize of the current layout runs. */
  reorganizing: boolean
  /** Outcome of the last reorganize of the layout on show, while it is current. */
  reorganized: ReorganizeOutcome | null
  /** Packs again with a deeper search and a fresh seed; keeps whichever layout is better. */
  reorganize: () => void
}

interface Shown {
  key: string
  layout: SheetLayout
  paper: Paper
}

const randomSeed = (): number => Math.floor(Math.random() * 2 ** 32)

/** Lays out the frames that have photos, a moment after the frames or paper settle. */
export function useSheetLayout(frames: Frame[], paper: Paper): SheetLayoutState {
  const request: PackRequest = {
    frames: frames
      .filter((f) => f.layers.length > 0)
      .map((f) => ({ id: f.id, widthMm: f.widthMm, heightMm: f.heightMm })),
    paper: {
      widthMm: paper.widthMm,
      heightMm: paper.heightMm,
      marginMm: paper.marginMm,
      gapMm: paper.gapMm,
    },
  }
  const key = JSON.stringify(request)
  const [shown, setShown] = useState<Shown | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  // A reorganize belongs to the layout it started from (or produced): any other layout
  // on show, or a change of frames or paper, retires it.
  const [reorg, setReorg] = useState<{ from: Shown; outcome: ReorganizeOutcome | null } | null>(
    null,
  )
  // Replies can arrive out of order; only the latest request may be shown.
  const latest = useRef(0)
  const keyNow = useRef(key)
  const shownNow = useRef(shown)
  const reorganizingNow = useRef(false)

  useEffect(() => {
    keyNow.current = key
    shownNow.current = shown
  })

  useEffect(() => {
    const id = ++latest.current
    const timer = setTimeout(() => {
      const parsed = JSON.parse(key) as PackRequest
      packFrames(parsed).then(
        (layout) => {
          if (id === latest.current) setShown({ key, layout, paper: parsed.paper })
        },
        (e: unknown) => {
          console.error(e)
          if (id === latest.current) setFailedKey(key)
        },
      )
    }, PACK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key])

  const current = shown?.key === key
  const mine = current && reorg?.from === shown ? reorg : null

  const reorganize = () => {
    const base = shown
    if (!base || base.key !== key || reorganizingNow.current) return
    reorganizingNow.current = true
    setReorg({ from: base, outcome: null })
    const retire = () => setReorg((r) => (r?.from === base ? null : r))
    const parsed = JSON.parse(base.key) as PackRequest
    packFrames({ ...parsed, seed: randomSeed(), effort: REORGANIZE_EFFORT })
      .then(
        (layout) => {
          if (keyNow.current !== base.key || shownNow.current !== base) return retire()
          if (betterLayout(layout, base.layout)) {
            const next = { ...base, layout }
            const reduced = layout.sheets.length < base.layout.sheets.length
            setShown(next)
            setReorg({ from: next, outcome: { reduced, sheets: layout.sheets.length } })
          } else {
            setReorg({ from: base, outcome: { reduced: false, sheets: base.layout.sheets.length } })
          }
        },
        (e: unknown) => {
          console.error(e)
          retire()
        },
      )
      .finally(() => {
        reorganizingNow.current = false
      })
  }

  return {
    layout: shown?.layout ?? null,
    paper: shown?.paper ?? null,
    current,
    failed: failedKey === key,
    reorganizing: mine !== null && mine.outcome === null,
    reorganized: mine?.outcome ?? null,
    reorganize,
  }
}
