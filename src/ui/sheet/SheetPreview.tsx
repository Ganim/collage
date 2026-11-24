import { Expand, ZoomIn, ZoomOut } from 'lucide-react'
import { useLayoutEffect, useState, type CSSProperties } from 'react'
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

/** Page width as a share of the width there is; 'fit' shows a whole page at once. */
type Zoom = 'fit' | number

const ZOOM_STEPS = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3]
const MIN_ZOOM = ZOOM_STEPS[0]!
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!
const STEP_SLACK = 0.005

export interface SheetZoom {
  /** The scrolling area the pages sit in; the zoom measures it. */
  stage: (element: HTMLDivElement | null) => void
  scale: number
  fitting: boolean
  /** The width each page is drawn at. */
  pageWidth: string
  zoomIn(): void
  zoomOut(): void
  showWholePage(): void
}

const padding = (style: CSSStyleDeclaration, a: 'Left' | 'Top', b: 'Right' | 'Bottom') =>
  parseFloat(style[`padding${a}`]) + parseFloat(style[`padding${b}`])

/** Zoom for the sheet preview: opens on a whole page, measured inside the stage. */
export function useSheetZoom(paper: Paper): SheetZoom {
  const [element, stage] = useState<HTMLDivElement | null>(null)
  const [room, setRoom] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<Zoom>('fit')

  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const style = getComputedStyle(element)
      setRoom({
        width: element.clientWidth - padding(style, 'Left', 'Right'),
        height: element.clientHeight - padding(style, 'Top', 'Bottom'),
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  const fit =
    room.width > 0 && room.height > 0
      ? Math.max(MIN_ZOOM, Math.min(1, (room.height * paper.widthMm) / paper.heightMm / room.width))
      : 1
  const scale = zoom === 'fit' ? fit : zoom
  return {
    stage,
    scale,
    fitting: zoom === 'fit',
    pageWidth: room.width > 0 ? `${Math.floor(room.width * scale)}px` : '100%',
    zoomIn: () => setZoom(ZOOM_STEPS.find((step) => step > scale + STEP_SLACK) ?? MAX_ZOOM),
    zoomOut: () => setZoom(ZOOM_STEPS.findLast((step) => step < scale - STEP_SLACK) ?? MIN_ZOOM),
    showWholePage: () => {
      setZoom('fit')
      element?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
    },
  }
}

export function ZoomControls({ zoom }: { zoom: Omit<SheetZoom, 'stage'> }) {
  return (
    <div className="print-zoom" role="toolbar" aria-label={t('print.zoom')}>
      <button
        type="button"
        className="icon-button print-zoom-button"
        aria-label={t('print.zoomOut')}
        title={t('print.zoomOut')}
        disabled={zoom.scale <= MIN_ZOOM + STEP_SLACK}
        onClick={zoom.zoomOut}
      >
        <ZoomOut size={20} />
      </button>
      <span className="print-zoom-level" aria-live="polite">
        {t('print.zoomLevel', { percent: Math.round(zoom.scale * 100) })}
      </span>
      <button
        type="button"
        className="icon-button print-zoom-button"
        aria-label={t('print.zoomIn')}
        title={t('print.zoomIn')}
        disabled={zoom.scale >= MAX_ZOOM - STEP_SLACK}
        onClick={zoom.zoomIn}
      >
        <ZoomIn size={20} />
      </button>
      <button
        type="button"
        className="print-zoom-fit"
        aria-pressed={zoom.fitting}
        onClick={zoom.showWholePage}
      >
        <Expand size={18} aria-hidden="true" />
        {t('print.zoomFit')}
      </button>
    </div>
  )
}

interface SheetPreviewProps {
  layout: SheetLayout
  paper: Paper
  frames: Frame[]
  stale: boolean
  pageWidth: string
}

export function SheetPreview({ layout, paper, frames, stale, pageWidth }: SheetPreviewProps) {
  const total = frames.length
  return (
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
  )
}
