import { ChevronDown, Download, Ellipsis, FolderOpen } from 'lucide-react'
import { useEditor } from '../../state/editor'
import { t } from '../i18n'
import { sizeChipText } from './sizeText'

interface HeaderProps {
  onSizeClick: () => void
  onCollections?: () => void
  onMore?: () => void
  onDownload?: () => void
}

export function Header({ onSizeClick, onCollections, onMore, onDownload }: HeaderProps) {
  const frame = useEditor((s) => s.collection.frames.find((f) => f.id === s.activeFrameId))
  const editing = useEditor((s) => s.mode === 'edit')
  const exitEdit = useEditor((s) => s.exitEdit)
  const name = useEditor((s) => s.collection.name)
  const shownName = name || t('library.unnamed')
  return (
    <header className="header">
      {frame && (
        <button type="button" className="size-chip" onClick={onSizeClick}>
          {sizeChipText(frame)}
          <ChevronDown size={16} />
        </button>
      )}
      <button
        type="button"
        className="work-chip"
        aria-label={t('header.collections', { name: shownName })}
        onClick={onCollections}
      >
        <FolderOpen size={18} />
        <span>{shownName}</span>
      </button>
      <div className="header-actions">
        {editing && (
          <button type="button" className="done-button" onClick={exitEdit}>
            {t('edit.done')}
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t('header.more')}
          onClick={onMore}
        >
          <Ellipsis size={22} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('header.download')}
          onClick={onDownload}
        >
          <Download size={22} />
        </button>
      </div>
    </header>
  )
}
