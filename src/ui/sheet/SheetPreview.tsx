import { Expand, ZoomIn, ZoomOut } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Frame, Paper } from '../../core/types'
import type { PlacedFrame, SheetLayout } from '../../packing/pack'
import { FrameView } from '../build/FrameView'
import { t } from '../i18n'

const percent = (part: number, whole: number) => `${(part / whole) * 100}%`

interface PlacedProps {
  placement: PlacedFrame
  frame: Frame
  paper: Paper
  label: string
}

function PlacedFrameView({ placement, frame, paper, label }: PlacedProps) {
  const [footWidth, footHeight] = placement.rotated
    ? [frame.heightMm, frame.widthMm]
    : [frame.widthMm, frame.heightMm]
  const position: CSSProperties = {
    left: percent(placement.xMm, paper.widthMm),
    top: percent(placement.yMm, paper.heightMm),
    width: percent(footWidth, paper.widthMm),
    height: percent(footHeight, paper.heightMm),
  }
  const inner: CSSProperties = {
    width: percent(frame.widthMm, footWidth),
    height: percent(frame.heightMm, footHeight),
    // Counter-clockwise, the way the PDF turns a rotated frame.
    transform: `translate(-50%, -50%) rotate(${placement.rotated ? -90 : 0}deg)`,
  }
  return (
    <div className="print-placed" style={position}>
      <div className="print-placed-inner" style={inner}>
        <FrameView frame={frame} interactive={false} label={label} />
      </div>
    </div>
  )
}

interface SheetPreviewProps {
  layout: SheetLayout
  paper: Paper
  frames: Frame[]
  stale: boolean
}

/** Page width as a share of the width there is; 'fit' shows a whole page at once. */
type Zoom = 'fit' | number

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3]
const MIN_ZOOM = ZOOM_STEPS[0]!
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!
const STEP_SLACK = 0.005
// Space kept clear below the toolbar and under the page, so a fitted page shows its shadow.
const FIT_ROOM_PX = 32

/** The width there is for a page, and the share of it a whole page fits in. */
function useFitScale(paper: Paper) {
  const area = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = area.current
    const scroller = element?.closest('.print-scroll')
    if (!element || !scroller) return
    const measure = () =>
      setRoom({
        width: element.clientWidth,
        height: scroller.clientHeight - (toolbar.current?.offsetHeight ?? 0) - FIT_ROOM_PX,
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  const fit =
    room.width > 0 && room.height > 0
      ? Math.max(MIN_ZOOM, Math.min(1, (room.height * paper.widthMm) / paper.heightMm / room.width))
      : 1
  return { area, toolbar, width: room.width, fit }
}

export function SheetPreview({ layout, paper, frames, stale }: SheetPreviewProps) {
  const total = frames.length
  const [zoom, setZoom] = useState<Zoom>('fit')
  const { area, toolbar, width, fit } = useFitScale(paper)
  const scale = zoom === 'fit' ? fit : zoom
  const zoomIn = () => setZoom(ZOOM_STEPS.find((step) => step > scale + STEP_SLACK) ?? MAX_ZOOM)
  const zoomOut = () =>
    setZoom(ZOOM_STEPS.findLast((step) => step < scale - STEP_SLACK) ?? MIN_ZOOM)
  const pageWidth = width > 0 ? `${Math.round(width * scale)}px` : '100%'

  return (
    <div className="print-preview">
      <div ref={toolbar} className="print-zoom" role="toolbar" aria-label={t('print.zoom')}>
        <button
          type="button"
          className="icon-button print-zoom-button"
          aria-label={t('print.zoomOut')}
          title={t('print.zoomOut')}
          disabled={scale <= MIN_ZOOM + STEP_SLACK}
          onClick={zoomOut}
        >
          <ZoomOut size={20} />
        </button>
        <span className="print-zoom-level" aria-live="polite">
          {t('print.zoomLevel', { percent: Math.round(scale * 100) })}
        </span>
        <button
          type="button"
          className="icon-button print-zoom-button"
          aria-label={t('print.zoomIn')}
          title={t('print.zoomIn')}
          disabled={scale >= MAX_ZOOM - STEP_SLACK}
          onClick={zoomIn}
        >
          <ZoomIn size={20} />
        </button>
        <button
          type="button"
          className="print-zoom-fit"
          aria-pressed={zoom === 'fit'}
          onClick={() => setZoom('fit')}
        >
          <Expand size={18} aria-hidden="true" />
          {t('print.zoomFit')}
        </button>
      </div>
      <div ref={area} className="print-zoom-area">
        <div className={stale ? 'print-sheets print-sheets--stale' : 'print-sheets'}>
          {layout.sheets.map((sheet, i) => (
            <div
              key={i}
              role="group"
              aria-label={t('print.pageLabel', { position: i + 1, total: layout.sheets.length })}
              className="print-page"
              style={{ width: pageWidth, aspectRatio: `${paper.widthMm} / ${paper.heightMm}` }}
            >
              {sheet.map((placement) => {
                const index = frames.findIndex((f) => f.id === placement.frameId)
                const frame = frames[index]
                if (!frame) return null
                return (
                  <PlacedFrameView
                    key={placement.frameId}
                    placement={placement}
                    frame={frame}
                    paper={paper}
                    label={t('frame.label', { position: index + 1, total })}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
