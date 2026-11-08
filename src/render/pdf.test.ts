import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  PrintScaling,
  type PDFPage,
} from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Paper, Size } from '../core/types'
import type { PlacedFrame, SheetLayout } from '../packing/pack'
import { buildPdf, findRulerSpot, placementToPdf } from './pdf'

const A4: Paper = { widthMm: 210, heightMm: 297, marginMm: 5, gapMm: 2 }
const frame: Size = { widthMm: 100, heightMm: 150 }
const pt = (mm: number): number => (mm / 25.4) * 72

/** A header-only JPEG: enough for the PDF embedder, which reads just the SOF marker. */
const jpeg = async (): Promise<Uint8Array> =>
  Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x11, 0x00, 0x02,
    0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ])

function place(frameId: string, xMm: number, yMm: number, rotated = false): PlacedFrame {
  return { frameId, xMm, yMm, rotated }
}

function layoutOf(...sheets: PlacedFrame[][]): SheetLayout {
  return { sheets, unplaced: [], usedRatio: 0 }
}

function contentOf(page: PDFPage): string {
  const contents = page.node.Contents()
  if (!(contents instanceof PDFArray)) throw new Error('expected a content array')
  const decoder = new TextDecoder()
  return Array.from({ length: contents.size() }, (_, i) =>
    decoder.decode(decodePDFRawStream(contents.lookup(i, PDFRawStream)).decode()),
  ).join('\n')
}

type Point = [number, number]
type Matrix = [number, number, number, number, number, number]

const apply = ([a, b, c, d, e, f]: Matrix, [x, y]: Point): Point => [
  a * x + c * y + e,
  b * x + d * y + f,
]

interface Box {
  left: number
  right: number
  bottom: number
  top: number
}

function boxOf(points: Point[]): Box {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  }
}

/** Page rectangle covered by each drawn image, following the real matrices of the content stream. */
function imageBoxes(content: string): Box[] {
  const num = String.raw`-?[\d.]+`
  const cm = String.raw`(?:${num} ){6}cm\n`
  return [...content.matchAll(new RegExp(String.raw`q\n((?:${cm})+)/\S+ Do`, 'g'))].map((match) => {
    const matrices = match[1]!
      .trim()
      .split('\n')
      .map((line) => line.split(' ').slice(0, 6).map(Number) as Matrix)
    const unitSquare: Point[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    return boxOf(unitSquare.map((p) => matrices.reduceRight((q, m) => apply(m, q), p)))
  })
}

function expectBox(actual: Box | undefined, expected: Box): void {
  expect(actual).toBeDefined()
  expect(actual!.left).toBeCloseTo(expected.left, 6)
  expect(actual!.right).toBeCloseTo(expected.right, 6)
  expect(actual!.bottom).toBeCloseTo(expected.bottom, 6)
  expect(actual!.top).toBeCloseTo(expected.top, 6)
}

interface Segment {
  start: Point
  end: Point
}

function lineSegments(content: string): Segment[] {
  return [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) m\n(-?[\d.]+) (-?[\d.]+) l\n/g)].map((m) => ({
    start: [Number(m[1]), Number(m[2])],
    end: [Number(m[3]), Number(m[4])],
  }))
}

describe('placementToPdf', () => {
  it('converts an unrotated placement, measuring y from the bottom', () => {
    const box = placementToPdf(place('f', 5, 10), frame, A4)
    expect(box.rotateDeg).toBe(0)
    expect(box.x).toBeCloseTo(pt(5), 9)
    expect(box.y).toBeCloseTo(pt(297 - 10 - 150), 9)
    expect(box.width).toBeCloseTo(pt(100), 9)
    expect(box.height).toBeCloseTo(pt(150), 9)
  })

  it('anchors a rotated frame so that turning about its lower-left corner fills the placement', () => {
    const box = placementToPdf(place('f', 5, 10, true), frame, A4)
    expect(box.rotateDeg).toBe(90)
    expect(box.x).toBeCloseTo(pt(5 + 150), 9)
    expect(box.y).toBeCloseTo(pt(297 - 10 - 100), 9)
    expect(box.width).toBeCloseTo(pt(100), 9)
    expect(box.height).toBeCloseTo(pt(150), 9)

    // A counter-clockwise quarter turn about (x, y) sends a local (u, v) to (x - v, y + u).
    const local: Point[] = [
      [0, 0],
      [box.width, 0],
      [box.width, box.height],
      [0, box.height],
    ]
    expectBox(boxOf(local.map(([u, v]): Point => [box.x - v, box.y + u])), {
      left: pt(5),
      right: pt(5 + 150),
      bottom: pt(297 - 10 - 100),
      top: pt(297 - 10),
    })
  })
})

describe('findRulerSpot', () => {
  const frames = {
    f: frame,
    wide: { widthMm: 200, heightMm: 189 },
    tall: { widthMm: 100, heightMm: 287 },
    full: { widthMm: 200, heightMm: 287 },
  }

  it('returns null when the sheet is full', () => {
    expect(findRulerSpot([place('full', 5, 5)], frames, A4)).toBeNull()
  })

  it('starts at the bottom-right corner of the usable area', () => {
    expect(findRulerSpot([place('f', 5, 5)], frames, A4)).toEqual({ xMm: 155, yMm: 286 })
  })

  it('walks the 5 mm grid upwards past a frame, keeping the gap as clearance', () => {
    // The frame starts at y 103, so the ruler (6 mm tall, 2 mm gap) must end by y 101.
    expect(findRulerSpot([place('wide', 5, 103)], frames, A4)).toEqual({ xMm: 155, yMm: 91 })
  })

  it('walks the grid leftwards along a row before moving up', () => {
    // The frame starts at x 105, so the ruler (50 mm wide, 2 mm gap) must start by x 53.
    expect(findRulerSpot([place('tall', 105, 5)], frames, A4)).toEqual({ xMm: 50, yMm: 286 })
  })

  it('uses the swapped footprint of a rotated frame', () => {
    // Rotated, the frame spans x 5..155 and y 192..292, which blocks the bottom-right start.
    expect(findRulerSpot([place('f', 5, 192, true)], frames, A4)).toEqual({ xMm: 155, yMm: 181 })
  })

  it('accepts a spot that fits the usable area exactly', () => {
    const tight: Paper = { widthMm: 60, heightMm: 16, marginMm: 5, gapMm: 2 }
    expect(findRulerSpot([], {}, tight)).toEqual({ xMm: 5, yMm: 5 })
  })

  it('returns null when the usable area is smaller than the ruler', () => {
    const small: Paper = { widthMm: 59, heightMm: 16, marginMm: 5, gapMm: 2 }
    expect(findRulerSpot([], {}, small)).toBeNull()
  })
})

describe('buildPdf', () => {
  const frames = { a: frame, b: frame, full: { widthMm: 200, heightMm: 287 } }

  async function build(layout: SheetLayout): Promise<PDFDocument> {
    return PDFDocument.load(await buildPdf(layout, frames, A4, jpeg))
  }

  it('makes A4 pages of 595.28 x 841.89 pt, one per sheet', async () => {
    const doc = await build(layoutOf([place('a', 5, 5)], [place('b', 5, 5)]))
    expect(doc.getPageCount()).toBe(2)
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 2)
      expect(page.getHeight()).toBeCloseTo(841.89, 2)
    }
  })

  it('adds no filler page to an empty layout', async () => {
    expect((await build(layoutOf())).getPageCount()).toBe(0)
  })

  it('asks viewers not to scale when printing', async () => {
    const doc = await build(layoutOf([]))
    expect(doc.catalog.getViewerPreferences()?.getPrintScaling()).toBe(PrintScaling.None)
  })

  it('draws a 100x150 frame at exactly 283.46 x 425.20 pt', async () => {
    const doc = await build(layoutOf([place('a', 5, 10)]))
    const [box] = imageBoxes(contentOf(doc.getPage(0)))
    expect(box!.right - box!.left).toBeCloseTo(283.46, 2)
    expect(box!.top - box!.bottom).toBeCloseTo(425.2, 2)
    expectBox(box, { left: pt(5), right: pt(105), bottom: pt(137), top: pt(287) })
  })

  it('fills the placement rectangle with a rotated frame in the written file', async () => {
    const doc = await build(layoutOf([place('a', 5, 10, true)]))
    expectBox(imageBoxes(contentOf(doc.getPage(0)))[0], {
      left: pt(5),
      right: pt(155),
      bottom: pt(187),
      top: pt(287),
    })
  })

  it('requests each JPEG once, one frame at a time', async () => {
    let active = 0
    const asked: string[] = []
    await buildPdf(layoutOf([place('a', 5, 5), place('b', 107, 5)]), frames, A4, async (id) => {
      expect(active).toBe(0)
      active++
      asked.push(id)
      const bytes = await jpeg()
      active--
      return bytes
    })
    expect(asked).toEqual(['a', 'b'])
  })

  it('rejects a placement whose frame is unknown', async () => {
    await expect(build(layoutOf([place('ghost', 5, 5)]))).rejects.toThrow('ghost')
  })

  it('draws a 5 cm ruler that stays inside its free spot', async () => {
    const doc = await build(layoutOf([place('a', 5, 5)]))
    const segments = lineSegments(contentOf(doc.getPage(0)))
    expect(segments.length).toBeGreaterThan(1)

    const bounds = boxOf(segments.flatMap((s) => [s.start, s.end]))
    expect(bounds.right - bounds.left).toBeLessThanOrEqual(pt(50))
    expect(bounds.left).toBeGreaterThanOrEqual(pt(155))
    expect(bounds.right).toBeLessThanOrEqual(pt(205))
    expect(bounds.bottom).toBeGreaterThanOrEqual(pt(5))
    expect(bounds.top).toBeLessThanOrEqual(pt(11))

    const baseline = segments.find((s) => s.start[1] === s.end[1])
    expect(baseline!.end[0] - baseline!.start[0]).toBeCloseTo(pt(50), 6)
  })

  it('omits the ruler when no spot is free', async () => {
    const doc = await build(layoutOf([place('full', 5, 5)]))
    expect(lineSegments(contentOf(doc.getPage(0)))).toEqual([])
  })
})
