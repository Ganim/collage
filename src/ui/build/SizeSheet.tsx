import { ArrowLeftRight } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { FRAME_PRESETS } from '../../core/presets'
import type { Size } from '../../core/types'
import { useEditor } from '../../state/editor'
import { BottomSheet } from '../components/BottomSheet'
import { t } from '../i18n'
import { sizeListText } from './sizeText'

interface SizeSheetProps {
  /** 'change' resizes the active frame; 'new' picks the size of a frame to create. */
  mode: 'change' | 'new'
  onClose: () => void
  onSizeNotSaved: () => void
}

const swapped = (s: Size): Size => ({ widthMm: s.heightMm, heightMm: s.widthMm })

export function SizeSheet({ mode, onClose, onSizeNotSaved }: SizeSheetProps) {
  const savedSizes = useEditor((s) => s.savedSizes)
  const addFrame = useEditor((s) => s.addFrame)
  const setActiveSize = useEditor((s) => s.setActiveSize)
  const flipActive = useEditor((s) => s.flipActive)
  const saveSize = useEditor((s) => s.saveSize)
  // Only a new frame flips before choosing; an existing one flips right away.
  const [flipped, setFlipped] = useState(false)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [name, setName] = useState('')

  const shown = (s: Size) => (flipped ? swapped(s) : s)

  const choose = (size: Size) => {
    if (mode === 'new') addFrame({ widthMm: size.widthMm, heightMm: size.heightMm })
    else setActiveSize({ widthMm: size.widthMm, heightMm: size.heightMm })
    onClose()
  }

  const flip = () => {
    if (mode === 'new') {
      setFlipped(!flipped)
    } else {
      flipActive()
      onClose()
    }
  }

  const submitCustom = async (e: FormEvent) => {
    e.preventDefault()
    const size: Size = { widthMm: Number(width) * 10, heightMm: Number(height) * 10 }
    const label = name.trim()
    if (label) {
      try {
        await saveSize(label, size)
      } catch (err) {
        console.error(err)
        onSizeNotSaved()
      }
    }
    choose(size)
  }

  return (
    <BottomSheet
      title={mode === 'new' ? t('sizeSheet.titleNew') : t('sizeSheet.titleChange')}
      onClose={onClose}
    >
      <button
        type="button"
        className="flip-button"
        aria-pressed={mode === 'new' ? flipped : undefined}
        onClick={flip}
      >
        <ArrowLeftRight size={18} />
        {t('sizeSheet.flip')}
      </button>

      <h3>{t('sizeSheet.presets')}</h3>
      <div className="size-grid">
        {FRAME_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="size-option"
            onClick={() => choose(shown(preset))}
          >
            {sizeListText(shown(preset))}
          </button>
        ))}
      </div>

      {savedSizes.length > 0 && (
        <>
          <h3>{t('sizeSheet.saved')}</h3>
          <div className="size-grid">
            {savedSizes.map((saved) => (
              <button
                key={saved.id}
                type="button"
                className="size-option"
                onClick={() => choose(shown(saved))}
              >
                <span>{saved.name}</span>
                <small>{sizeListText(shown(saved))}</small>
              </button>
            ))}
          </div>
        </>
      )}

      <h3>{t('sizeSheet.custom')}</h3>
      <form className="custom-size" onSubmit={(e) => void submitCustom(e)}>
        <label>
          {t('sizeSheet.width')}
          <input
            type="number"
            inputMode="decimal"
            min="1"
            step="0.1"
            required
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          />
        </label>
        <label>
          {t('sizeSheet.height')}
          <input
            type="number"
            inputMode="decimal"
            min="1"
            step="0.1"
            required
            value={height}
            onChange={(e) => setHeight(e.target.value)}
          />
        </label>
        <label className="custom-size-wide">
          {t('sizeSheet.name')}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="primary-button custom-size-wide">
          {t('sizeSheet.use')}
        </button>
      </form>
    </BottomSheet>
  )
}
