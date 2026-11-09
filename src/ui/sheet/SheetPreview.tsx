import type { CSSProperties } from 'react'
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

export function SheetPreview({ layout, paper, frames, stale }: SheetPreviewProps) {
  const total = frames.length
  return (
    <div className={stale ? 'print-sheets print-sheets--stale' : 'print-sheets'}>
      {layout.sheets.map((sheet, i) => (
        <div
          key={i}
          role="group"
          aria-label={t('print.pageLabel', { position: i + 1, total: layout.sheets.length })}
          className="print-page"
          style={{ aspectRatio: `${paper.widthMm} / ${paper.heightMm}` }}
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
