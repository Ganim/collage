import { degrees, PDFDocument, PDFPage, PrintScaling, rgb } from 'pdf-lib'
import type { Collection, Paper, Size } from '../core/types'
import type { PlacedFrame, SheetLayout } from '../packing/pack'
import type { Store } from '../storage/store'
import { browserRaster, composeFrame, MissingPhotoError, type Raster } from './compose'

export interface GenerateRequest {
  collection: Collection
  layout: SheetLayout
}

const RULER_LENGTH_MM = 50
const RULER_HEIGHT_MM = 6
const RULER_MINOR_TICK_MM = 3
const RULER_TICK_SPACING_MM = 10
const RULER_GRID_MM = 5
const RULER_LINE_PT = 0.25

const mmToPt = (mm: number): number => (mm / 25.4) * 72

function frameSize(frames: Record<string, Size>, frameId: string): Size {
  const frame = frames[frameId]
  if (!frame) throw new Error(`Unknown frame in layout: ${frameId}`)
  return frame
}

export function placementToPdf(
  p: PlacedFrame,
  frame: Size,
  paper: Size,
): { x: number; y: number; width: number; height: number; rotateDeg: 0 | 90 } {
  const width = mmToPt(frame.widthMm)
  const height = mmToPt(frame.heightMm)
  if (p.rotated) {
    // pdf-lib turns counter-clockwise about the lower-left corner, which swings the
    // image to the left of its anchor: the anchor is the placement's lower-right corner.
    return {
      x: mmToPt(p.xMm + frame.heightMm),
      y: mmToPt(paper.heightMm - p.yMm - frame.widthMm),
      width,
      height,
      rotateDeg: 90,
    }
  }
  return {
    x: mmToPt(p.xMm),
    y: mmToPt(paper.heightMm - p.yMm - frame.heightMm),
    width,
    height,
    rotateDeg: 0,
  }
}

/** Top-left of a free ruler footprint in sheet millimetres, searched from the bottom-right corner. */
export function findRulerSpot(
  sheet: PlacedFrame[],
  frames: Record<string, Size>,
  paper: Paper,
): { xMm: number; yMm: number } | null {
  const obstacles = sheet.map((p) => {
    const frame = frameSize(frames, p.frameId)
    const [w, h] = p.rotated ? [frame.heightMm, frame.widthMm] : [frame.widthMm, frame.heightMm]
    return { left: p.xMm, top: p.yMm, right: p.xMm + w, bottom: p.yMm + h }
  })
  const isFree = (x: number, y: number): boolean =>
    obstacles.every(
      (o) =>
        x + RULER_LENGTH_MM + paper.gapMm <= o.left ||
        x - paper.gapMm >= o.right ||
        y + RULER_HEIGHT_MM + paper.gapMm <= o.top ||
        y - paper.gapMm >= o.bottom,
    )

  const maxX = paper.widthMm - paper.marginMm - RULER_LENGTH_MM
  const maxY = paper.heightMm - paper.marginMm - RULER_HEIGHT_MM
  for (let row = 0; maxY - row * RULER_GRID_MM >= paper.marginMm; row++) {
    const y = maxY - row * RULER_GRID_MM
    for (let column = 0; maxX - column * RULER_GRID_MM >= paper.marginMm; column++) {
      const x = maxX - column * RULER_GRID_MM
      if (isFree(x, y)) return { xMm: x, yMm: y }
    }
  }
  return null
}

/** Draws the ruler with every stroke inside its footprint, so the outer edges span exactly 5 cm. */
function drawRuler(page: PDFPage, spot: { xMm: number; yMm: number }, paper: Paper): void {
  const inset = RULER_LINE_PT / 2
  const left = mmToPt(spot.xMm)
  const right = mmToPt(spot.xMm + RULER_LENGTH_MM)
  const bottom = mmToPt(paper.heightMm - spot.yMm - RULER_HEIGHT_MM)
  const line = (x1: number, y1: number, x2: number, y2: number): void =>
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: RULER_LINE_PT,
      color: rgb(0, 0, 0),
    })

  line(left, bottom + inset, right, bottom + inset)
  for (let mm = 0; mm <= RULER_LENGTH_MM; mm += RULER_TICK_SPACING_MM) {
    const isEnd = mm === 0 || mm === RULER_LENGTH_MM
    const x = Math.min(right - inset, Math.max(left + inset, mmToPt(spot.xMm + mm)))
    line(x, bottom, x, bottom + mmToPt(isEnd ? RULER_HEIGHT_MM : RULER_MINOR_TICK_MM))
  }
}

export async function buildPdf(
  layout: SheetLayout,
  frames: Record<string, Size>,
  paper: Paper,
  jpegs: (frameId: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None)

  for (const sheet of layout.sheets) {
    const page = doc.addPage([mmToPt(paper.widthMm), mmToPt(paper.heightMm)])
    for (const placement of sheet) {
      const frame = frameSize(frames, placement.frameId)
      const image = await doc.embedJpg(await jpegs(placement.frameId))
      const { x, y, width, height, rotateDeg } = placementToPdf(placement, frame, paper)
      page.drawImage(image, { x, y, width, height, rotate: degrees(rotateDeg) })
    }
    const spot = findRulerSpot(sheet, frames, paper)
    if (spot) drawRuler(page, spot, paper)
  }
  return doc.save({ addDefaultPage: false })
}

/** Renders the laid-out frames to a PDF. The canvas work goes through `raster`. */
export async function generatePdfWith(
  store: Store,
  { collection, layout }: GenerateRequest,
  onProgress: (done: number, total: number) => void,
  raster: Raster = browserRaster,
): Promise<Blob> {
  const framesById = new Map(collection.frames.map((f) => [f.id, f]))
  const placed = layout.sheets.flat().map((p) => {
    const frame = framesById.get(p.frameId)
    if (!frame) throw new Error(`Unknown frame in layout: ${p.frameId}`)
    return frame
  })

  const known = await store.getPhotosMeta([
    ...new Set(placed.flatMap((f) => f.layers.map((l) => l.photoId))),
  ])
  const affected = placed.filter((f) => f.layers.some((l) => !known[l.photoId]))
  if (affected.length > 0) throw new MissingPhotoError(affected.map((f) => f.id))

  let done = 0
  const bytes = await buildPdf(
    layout,
    Object.fromEntries(framesById),
    collection.paper,
    async (frameId) => {
      const frame = framesById.get(frameId)!
      const jpeg = await composeFrame(
        frame,
        async (photoId) => {
          const photo = await store.getPhoto(photoId)
          if (!photo) throw new MissingPhotoError([frameId])
          return photo
        },
        raster,
      )
      onProgress(++done, placed.length)
      return jpeg
    },
  )
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}
