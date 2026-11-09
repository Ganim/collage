import { useDrag, useGesture } from '@use-gesture/react'
import { useEffect, type RefObject } from 'react'
import type { Frame, Layer } from '../../core/types'
import { useEditor } from '../../state/editor'
import { cornerScale, dragToPatch, keepInFrame, layerAt, pinchToPatch } from './gesture'

const TAP_THRESHOLD_PX = 10
/** One notch of a mouse wheel is about 100 px, which this turns into about 22%. */
const WHEEL_SPEED = 0.002
const WHEEL_LINE_PX = 33

interface LayerGesturesArgs {
  /** Holds everything the fingers can touch while editing. */
  root: RefObject<HTMLElement | null>
  /** Has the frame's size and position on screen. */
  surface: RefObject<HTMLElement | null>
  frame: Frame
  selected: Layer
}

export function useLayerGestures({ root, surface, frame, selected }: LayerGesturesArgs) {
  const photos = useEditor((s) => s.photos)
  const transformSelected = useEditor((s) => s.transformSelected)
  const selectLayer = useEditor((s) => s.selectLayer)
  const zoomSelected = useEditor((s) => s.zoomSelected)
  const isBackground = frame.layers[0]?.id === selected.id

  const frameRect = () => {
    const el = surface.current
    if (!el) throw new Error('The edit surface is not mounted')
    return el.getBoundingClientRect()
  }

  // Each gesture works from the layer as it was when the fingers landed.
  const startOf = (first: boolean, memo: unknown): Layer =>
    first || !memo ? selected : (memo as Layer)

  const bindSurface = useGesture(
    {
      onDrag: ({ first, tap, pinching, cancel, memo, xy: [x, y], movement: [mx, my] }) => {
        if (pinching) {
          cancel()
          return memo as unknown
        }
        const rect = frameRect()
        if (tap) {
          const hit = layerAt(frame.layers, photos, rect, x - rect.left, y - rect.top)
          if (hit) selectLayer(hit.id)
          return undefined
        }
        const start = startOf(first, memo)
        const moved = dragToPatch(start, mx, my, rect)
        transformSelected(isBackground ? moved : keepInFrame(moved))
        return start
      },
      onPinch: ({ first, memo, movement: [ratio, angle] }) => {
        const start = startOf(first, memo)
        transformSelected(pinchToPatch(start, ratio, angle, !isBackground))
        return start
      },
    },
    // A resting finger jitters: the library adds up every small move, so 3 px is too tight.
    { drag: { filterTaps: true, tapsThreshold: TAP_THRESHOLD_PX } },
  )

  const bindHandle = useDrag(({ first, memo, xy, initial }) => {
    const start = startOf(first, memo)
    const rect = frameRect()
    const center = [rect.left + start.cx * rect.width, rect.top + start.cy * rect.height] as const
    transformSelected(pinchToPatch(start, cornerScale(center, initial, xy), 0, false))
    return start
  })

  // iOS Safari zooms the page on its own proprietary pinch events, whatever touch-action says.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const block = (e: Event) => e.preventDefault()
    el.addEventListener('gesturestart', block, { passive: false })
    el.addEventListener('gesturechange', block, { passive: false })
    return () => {
      el.removeEventListener('gesturestart', block)
      el.removeEventListener('gesturechange', block)
    }
  }, [root])

  // React listens to wheel passively, and only an active listener can stop the page scrolling.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const zoom = (e: WheelEvent) => {
      e.preventDefault()
      const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_PX : e.deltaY
      zoomSelected(Math.exp(-px * WHEEL_SPEED))
    }
    el.addEventListener('wheel', zoom, { passive: false })
    return () => el.removeEventListener('wheel', zoom)
  }, [root, zoomSelected])

  return { bindSurface, bindHandle }
}
