import type { Size } from '../../core/types'
import { t } from '../i18n'

const MIN_CM = 1
const MAX_CM = 100

const cm = (mm: number) => (mm / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })

/** "10 × 15 cm" */
export const sizeChipText = (s: Size) => t('size.chip', { w: cm(s.widthMm), h: cm(s.heightMm) })

/** "10×15 cm", the way the ready-made sizes are written. */
export const sizeListText = (s: Size) => t('size.list', { w: cm(s.widthMm), h: cm(s.heightMm) })

/** Reads a length typed in cm, with comma or period, as whole millimetres; null if unusable. */
export function parseCm(value: string): number | null {
  const text = value.trim()
  if (!/^\d+([.,]\d+)?$/.test(text)) return null
  const centimetres = Number(text.replace(',', '.'))
  if (centimetres < MIN_CM || centimetres > MAX_CM) return null
  return Math.round(centimetres * 10)
}
