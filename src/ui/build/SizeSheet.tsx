import { ArrowLeftRight } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import type { SizePreset } from '../../core/presets'
import type { SavedSize, Size } from '../../core/types'
import { useEditor } from '../../state/editor'
import { BottomSheet } from '../components/BottomSheet'
import { groupSizes, isPreset, type SizeGroup } from '../home/folders'
import { t } from '../i18n'
import { parseCm, sizeListText } from './sizeText'

interface SizeSheetProps {
  /** 'change' resizes the active frame; 'new' picks the size of a frame to create. */
  mode: 'change' | 'new'
  onClose: () => void
  onSizeNotSaved: () => void
}

const swapped = (s: Size): Size => ({ widthMm: s.heightMm, heightMm: s.widthMm })

interface SizeGroupOptionsProps {
  group: SizeGroup
  shown: (s: Size) => Size
  onChoose: (s: Size) => void
}

/** One folder's sizes under its name. */
function SizeGroupOptions({ group, shown, onChoose }: SizeGroupOptionsProps) {
  const titleId = useId()
  const option = (size: SavedSize | SizePreset) => (
    <button key={size.id} type="button" className="size-option" onClick={() => onChoose(size)}>
      {isPreset(size) ? (
        sizeListText(shown(size))
      ) : (
        <>
          <span>{size.name}</span>
          <small>{sizeListText(shown(size))}</small>
        </>
      )}
    </button>
  )
  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId}>{group.name}</h3>
      <div className="size-grid">{group.sizes.map(option)}</div>
    </section>
  )
}

export function SizeSheet({ mode, onClose, onSizeNotSaved }: SizeSheetProps) {
  const savedSizes = useEditor((s) => s.savedSizes)
  const folders = useEditor((s) => s.folders)
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

  const widthMm = parseCm(width)
  const heightMm = parseCm(height)
  const invalid =
    (width.trim() !== '' && widthMm === null) || (height.trim() !== '' && heightMm === null)

  const submitCustom = async (e: FormEvent) => {
    e.preventDefault()
    if (widthMm === null || heightMm === null) return
    const size: Size = { widthMm, heightMm }
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

      {groupSizes(folders, savedSizes)
        .filter((group) => group.sizes.length > 0)
        .map((group) => (
          <SizeGroupOptions
            key={group.id}
            group={group}
            shown={shown}
            onChoose={(s) => choose(shown(s))}
          />
        ))}

      <h3>{t('sizeSheet.custom')}</h3>
      <form className="custom-size" onSubmit={(e) => void submitCustom(e)}>
        <label>
          {t('sizeSheet.width')}
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={width.trim() !== '' && widthMm === null}
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          />
        </label>
        <label>
          {t('sizeSheet.height')}
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={height.trim() !== '' && heightMm === null}
            value={height}
            onChange={(e) => setHeight(e.target.value)}
          />
        </label>
        {invalid && (
          <p className="custom-size-error custom-size-wide" role="status">
            {t('sizeSheet.invalid')}
          </p>
        )}
        <label className="custom-size-wide">
          {t('sizeSheet.name')}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          type="submit"
          className="primary-button custom-size-wide"
          disabled={widthMm === null || heightMm === null}
        >
          {t('sizeSheet.use')}
        </button>
      </form>
    </BottomSheet>
  )
}
