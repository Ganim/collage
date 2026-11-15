import { ArrowLeftRight, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import type { SizePreset } from '../../core/presets'
import type { SavedSize, Size } from '../../core/types'
import { useEditor } from '../../state/editor'
import { BottomSheet } from '../components/BottomSheet'
import { DEFAULTS_ID, groupSizes, isPreset } from '../home/folders'
import { SizeForm } from '../home/SizeForm'
import { t } from '../i18n'
import { sizeListText } from './sizeText'

interface SizeSheetProps {
  /**
   * 'change' resizes the active frame; 'new' picks the size of a frame to create; 'pick' only
   * hands the size to onPick, which closes the sheet or replaces it.
   */
  mode: 'change' | 'new' | 'pick'
  onClose: () => void
  onPick?: (size: Size) => void
}

/** The folder the sheet opened on last time, on this device. */
const FOLDER_KEY = 'collage.sizeSheetFolder'

function rememberedFolder(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY)
  } catch {
    return null
  }
}

function rememberFolder(id: string) {
  try {
    localStorage.setItem(FOLDER_KEY, id)
  } catch {
    // Only a convenience: the sheet opens on the ready-made sizes instead.
  }
}

const swapped = (s: Size): Size => ({ widthMm: s.heightMm, heightMm: s.widthMm })

/**
 * Picks a size from any folder, or creates one: it is saved in the chosen folder and used
 * right away.
 */
export function SizeSheet({ mode, onClose, onPick }: SizeSheetProps) {
  const savedSizes = useEditor((s) => s.savedSizes)
  const folders = useEditor((s) => s.folders)
  const addFrame = useEditor((s) => s.addFrame)
  const setActiveSize = useEditor((s) => s.setActiveSize)
  const flipActive = useEditor((s) => s.flipActive)
  // Only a new frame flips before choosing; an existing one flips right away.
  const [flipped, setFlipped] = useState(false)
  const [creating, setCreating] = useState(false)
  const groups = groupSizes(folders, savedSizes)
  const [folderId, setFolderId] = useState(() => {
    const last = rememberedFolder()
    return last && groups.some((g) => g.id === last) ? last : DEFAULTS_ID
  })
  const group = groups.find((g) => g.id === folderId) ?? groups[0]!
  const titleId = useId()

  const shown = (s: Size) => (flipped ? swapped(s) : s)

  const openFolder = (id: string) => {
    setFolderId(id)
    rememberFolder(id)
  }

  const use = (size: Size) => {
    if (mode === 'pick') {
      // The caller decides what comes next, often another sheet.
      onPick?.({ widthMm: size.widthMm, heightMm: size.heightMm })
      return
    }
    if (mode === 'new') addFrame({ widthMm: size.widthMm, heightMm: size.heightMm })
    else setActiveSize({ widthMm: size.widthMm, heightMm: size.heightMm })
    onClose()
  }

  const flip = () => {
    if (mode !== 'change') {
      setFlipped(!flipped)
    } else {
      flipActive()
      onClose()
    }
  }

  const option = (size: SavedSize | SizePreset) => (
    <button key={size.id} type="button" className="size-option" onClick={() => use(shown(size))}>
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
    <>
      <BottomSheet
        title={
          mode === 'pick'
            ? t('sizeSheet.titlePick')
            : mode === 'new'
              ? t('sizeSheet.titleNew')
              : t('sizeSheet.titleChange')
        }
        onClose={onClose}
      >
        <button
          type="button"
          className="flip-button"
          aria-pressed={mode !== 'change' ? flipped : undefined}
          onClick={flip}
        >
          <ArrowLeftRight size={18} />
          {t('sizeSheet.flip')}
        </button>

        <div className="folder-chips" role="group" aria-label={t('sizeSheet.folders')}>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className="folder-chip"
              aria-pressed={g.id === group.id}
              onClick={() => openFolder(g.id)}
            >
              {g.name}
              <span className="folder-chip-count">{g.sizes.length}</span>
            </button>
          ))}
        </div>

        <section aria-labelledby={titleId}>
          <h3 id={titleId}>{group.name}</h3>
          {group.sizes.length === 0 && (
            <p className="size-folder-empty">{t('sizeSheet.folderEmpty')}</p>
          )}
          <div className="size-grid">
            {group.sizes.map(option)}
            <button
              type="button"
              className="size-option size-option--new"
              onClick={() => setCreating(true)}
            >
              <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
              {t('sizeSheet.newSize')}
            </button>
          </div>
        </section>
      </BottomSheet>
      {creating && (
        <SizeForm
          folderId={group.id}
          onClose={() => setCreating(false)}
          onSaved={(size, savedIn) => {
            // Opens on the folder the size went to next time.
            rememberFolder(savedIn)
            setCreating(false)
            use(size)
          }}
        />
      )}
    </>
  )
}
