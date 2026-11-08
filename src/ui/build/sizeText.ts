import type { Size } from '../../core/types'
import { t } from '../i18n'

const cm = (mm: number) => (mm / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })

/** "10 × 15 cm" */
export const sizeChipText = (s: Size) => t('size.chip', { w: cm(s.widthMm), h: cm(s.heightMm) })

/** "10×15 cm", the way the ready-made sizes are written. */
export const sizeListText = (s: Size) => t('size.list', { w: cm(s.widthMm), h: cm(s.heightMm) })
