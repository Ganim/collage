import { Shuffle } from 'lucide-react'
import { t } from '../i18n'
import type { ReorganizeOutcome } from './useSheetLayout'

interface Props {
  disabled: boolean
  reorganizing: boolean
  reorganized: ReorganizeOutcome | null
  onReorganize: () => void
}

/** "Reorganizar encaixe": a deeper search for a layout with fewer sheets, and its outcome. */
export function ReorganizeSection({ disabled, reorganizing, reorganized, onReorganize }: Props) {
  let message = ''
  if (reorganized?.reduced) {
    message =
      reorganized.sheets === 1
        ? t('print.reorganizedOne')
        : t('print.reorganizedMany', { count: reorganized.sheets })
  } else if (reorganized) {
    message = t('print.reorganizeSame')
  }

  return (
    <div className="print-reorganize">
      <button
        type="button"
        className="secondary-button print-reorganize-button"
        disabled={disabled || reorganizing}
        onClick={onReorganize}
      >
        <Shuffle size={18} aria-hidden="true" />
        {reorganizing ? t('print.reorganizing') : t('print.reorganize')}
      </button>
      <p className="print-reorganize-status" role="status">
        {message}
      </p>
    </div>
  )
}
