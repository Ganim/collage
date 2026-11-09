import { useEffect, useRef, useState } from 'react'
import type { Frame, Paper } from '../../core/types'
import { packFrames, type PackRequest, type SheetLayout } from '../../packing/pack'

const PACK_DELAY_MS = 200

/** What the sheet screen shows: the latest layout, with the paper it was computed for. */
export interface SheetLayoutState {
  layout: SheetLayout | null
  paper: Paper | null
  /** True only while the layout matches the current frames and paper. */
  current: boolean
  failed: boolean
}

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
  const [shown, setShown] = useState<{
    key: string
    layout: SheetLayout
    paper: Paper
  } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  // Replies can arrive out of order; only the latest request may be shown.
  const latest = useRef(0)

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

  return {
    layout: shown?.layout ?? null,
    paper: shown?.paper ?? null,
    current: shown?.key === key,
    failed: failedKey === key,
  }
}
