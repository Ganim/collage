import type { Paper, Size } from './types'

export interface SizePreset extends Size {
  id: string
  label: string
}

const cm = (id: string, w: number, h: number): SizePreset => ({
  id,
  label: `${w}×${h} cm`,
  widthMm: w * 10,
  heightMm: h * 10,
})

export const FRAME_PRESETS: SizePreset[] = [
  cm('10x15', 10, 15),
  cm('13x18', 13, 18),
  cm('15x21', 15, 21),
  cm('20x25', 20, 25),
  cm('20x30', 20, 30),
  cm('5x7', 5, 7),
]

/** Ready-made papers. A custom paper is a UI choice, not a preset. */
export const PAPER_PRESETS: SizePreset[] = [
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420 },
  { id: 'letter', label: 'Letter', widthMm: 215.9, heightMm: 279.4 },
]

export function defaultPaper(): Paper {
  return { widthMm: 210, heightMm: 297, marginMm: 5, gapMm: 3 }
}
