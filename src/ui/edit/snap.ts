import type { FramePx } from './gesture'

/** Close enough to feel magnetic, small enough for a fine adjustment right beside a centre. */
const SNAP_PX = 8

export interface SnapTargets {
  x: readonly number[]
  y: readonly number[]
}

export interface Snapped {
  cx: number
  cy: number
  /** Where to draw a line, as a fraction of the frame; null when that axis is not aligned. */
  guideX: number | null
  guideY: number | null
}

function nearest(value: number, targets: readonly number[], sizePx: number): number | null {
  let best: number | null = null
  let bestPx = SNAP_PX
  for (const target of targets) {
    const px = Math.abs(value - target) * sizePx
    if (px <= bestPx) {
      best = target
      bestPx = px
    }
  }
  return best
}

export function snapToCenters(
  position: { cx: number; cy: number },
  targets: SnapTargets,
  framePx: FramePx,
): Snapped {
  const guideX = nearest(position.cx, targets.x, framePx.width)
  const guideY = nearest(position.cy, targets.y, framePx.height)
  return { cx: guideX ?? position.cx, cy: guideY ?? position.cy, guideX, guideY }
}
