import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import type { Size } from '../../core/types'
import { BottomSheet } from '../components/BottomSheet'
import { t } from '../i18n'
import { sizeListText } from './sizeText'

const MAX = 30

interface QuantitySheetProps {
  size: Size
  onConfirm: (count: number) => void
  onClose: () => void
}

/** How many empty frames of a size to add at once. */
export function QuantitySheet({ size, onConfirm, onClose }: QuantitySheetProps) {
  const [count, setCount] = useState(1)
  const label = sizeListText(size)
  return (
    <BottomSheet title={t('quantity.title')} onClose={onClose}>
      <div className="quantity">
        <button
          type="button"
          className="quantity-step"
          aria-label={t('quantity.less')}
          disabled={count <= 1}
          onClick={() => setCount(count - 1)}
        >
          <Minus size={22} strokeWidth={2.5} />
        </button>
        <output className="quantity-value" aria-label={t('quantity.value')} aria-live="polite">
          {count}
        </output>
        <button
          type="button"
          className="quantity-step"
          aria-label={t('quantity.more')}
          disabled={count >= MAX}
          onClick={() => setCount(count + 1)}
        >
          <Plus size={22} strokeWidth={2.5} />
        </button>
      </div>
      <button
        type="button"
        className="primary-button quantity-confirm"
        onClick={() => {
          onConfirm(count)
          onClose()
        }}
      >
        {count === 1
          ? t('quantity.addOne', { size: label })
          : t('quantity.addMany', { count, size: label })}
      </button>
    </BottomSheet>
  )
}
