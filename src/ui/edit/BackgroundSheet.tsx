import { Check, Pipette } from 'lucide-react'
import { DEFAULT_FRAME_BACKGROUND } from '../../core/types'
import { useEditor } from '../../state/editor'
import { BottomSheet } from '../components/BottomSheet'
import { t } from '../i18n'

export const BACKGROUND_SWATCHES = [
  '#ffffff',
  '#f5f5f4',
  '#d6d3d1',
  '#78716c',
  '#1c1917',
  '#000000',
  '#fdf4ff',
  '#f5d0fe',
  '#fce7f3',
  '#fef3c7',
  '#dcfce7',
  '#dbeafe',
]

/** Picks the colour that shows around a background photo smaller than its frame. */
export function BackgroundSheet({ onClose }: { onClose: () => void }) {
  const current = useEditor(
    (s) =>
      s.collection.frames.find((f) => f.id === s.activeFrameId)?.background ??
      DEFAULT_FRAME_BACKGROUND,
  )
  const setActiveBackground = useEditor((s) => s.setActiveBackground)
  const custom = !BACKGROUND_SWATCHES.includes(current.toLowerCase())

  return (
    <BottomSheet title={t('background.title')} onClose={onClose}>
      <p className="background-hint">{t('background.hint')}</p>
      <div className="background-swatches" role="radiogroup" aria-label={t('background.title')}>
        {BACKGROUND_SWATCHES.map((color) => {
          const chosen = current.toLowerCase() === color
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={color}
              className="background-swatch"
              style={{ background: color }}
              onClick={() => setActiveBackground(color)}
            >
              {chosen && <Check size={18} aria-hidden="true" />}
            </button>
          )
        })}
        <label
          className={
            custom
              ? 'background-swatch background-custom is-chosen'
              : 'background-swatch background-custom'
          }
          style={custom ? { background: current } : undefined}
          title={t('background.custom')}
        >
          <input
            type="color"
            aria-label={t('background.custom')}
            value={current}
            onChange={(e) => setActiveBackground(e.target.value.toLowerCase())}
          />
          <Pipette size={18} aria-hidden="true" />
        </label>
      </div>
    </BottomSheet>
  )
}
