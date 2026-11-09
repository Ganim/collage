import { emptyFrames, lowResolutionLayers } from '../../core/quality'
import type { Frame, Photo } from '../../core/types'
import { t } from '../i18n'

interface WarningsProps {
  frames: Frame[]
  photos: Record<string, Photo>
  unplacedIds: string[]
  missingFrameIds: string[]
  nothingToPrint: boolean
}

export function Warnings({
  frames,
  photos,
  unplacedIds,
  missingFrameIds,
  nothingToPrint,
}: WarningsProps) {
  const numbers = (ids: string[]) =>
    ids
      .map((id) => frames.findIndex((f) => f.id === id) + 1)
      .sort((a, b) => a - b)
      .join(', ')

  const errors: string[] = []
  if (unplacedIds.length > 0) {
    errors.push(
      t(unplacedIds.length === 1 ? 'print.oversizedOne' : 'print.oversizedMany', {
        frames: numbers(unplacedIds),
      }),
    )
  }
  if (missingFrameIds.length > 0) {
    errors.push(
      t(missingFrameIds.length === 1 ? 'print.missingOne' : 'print.missingMany', {
        frames: numbers(missingFrameIds),
      }),
    )
  }

  const warnings: string[] = []
  const empty = emptyFrames(frames).length
  if (empty > 0) {
    warnings.push(empty === 1 ? t('print.emptyOne') : t('print.emptyMany', { count: empty }))
  }
  const low = lowResolutionLayers(frames, photos)
  if (low.length > 0) {
    const lowFrames = [...new Set(low.map((l) => l.frameId))]
    const list = t(lowFrames.length === 1 ? 'print.framesOne' : 'print.framesMany', {
      list: numbers(lowFrames),
    })
    warnings.push(
      low.length === 1
        ? t('print.lowResOne', { frames: list })
        : t('print.lowResMany', { count: low.length, frames: list }),
    )
  }
  if (nothingToPrint && warnings.length === 0) warnings.push(t('print.nothing'))

  if (errors.length === 0 && warnings.length === 0) return null
  return (
    <ul className="print-warnings">
      {errors.map((text) => (
        <li key={text} className="print-warning print-warning--error" role="alert">
          {text}
        </li>
      ))}
      {warnings.map((text) => (
        <li key={text} className="print-warning">
          {text}
        </li>
      ))}
    </ul>
  )
}
