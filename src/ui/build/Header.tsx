import { ChevronDown, Download, Ellipsis } from 'lucide-react'
import { useEditor } from '../../state/editor'
import { t } from '../i18n'
import { sizeChipText } from './sizeText'

interface HeaderProps {
  onSizeClick: () => void
  onMore?: () => void
  onDownload?: () => void
}

export function Header({ onSizeClick, onMore, onDownload }: HeaderProps) {
  const frame = useEditor((s) => s.collection.frames.find((f) => f.id === s.activeFrameId))
  const editing = useEditor((s) => s.mode === 'edit')
  const exitEdit = useEditor((s) => s.exitEdit)
  return (
    <header className="header">
      {frame && (
        <button type="button" className="size-chip" onClick={onSizeClick}>
          {sizeChipText(frame)}
          <ChevronDown size={16} />
        </button>
      )}
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
