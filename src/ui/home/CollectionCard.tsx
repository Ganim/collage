import { Copy, Pencil, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { CollectionSummary } from '../../storage/store'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Kebab } from '../components/Kebab'
import { RenameSheet } from '../components/RenameSheet'
import { t } from '../i18n'
import { EmptyFrameIllustration } from '../illustrations'
import { usePhotoUrl } from '../usePhotoUrl'

const details = (item: CollectionSummary) => {
  const frames =
    item.frameCount === 0
      ? t('library.framesNone')
      : item.frameCount === 1
        ? t('library.framesOne')
        : t('library.framesMany', { count: item.frameCount })
  return `${frames} · ${new Date(item.updatedAt).toLocaleDateString('pt-BR')}`
}

function CoverPhoto({ photoId }: { photoId: string }) {
  const url = usePhotoUrl(photoId, 'thumb')
  return url ? <img src={url} alt="" draggable={false} /> : null
}

interface CollectionCardProps {
  item: CollectionSummary
  disabled: boolean
  onOpen: () => void
  onRename: (name: string) => void
  onDuplicate: () => void
  onDelete: () => void
}

/** A collection on the list: its cover, pinned like a printed photo, its name and details. */
export function CollectionCard({
  item,
  disabled,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: CollectionCardProps) {
  const [sheet, setSheet] = useState<'rename' | 'delete' | null>(null)
  const detailsId = useId()
  const name = item.name || t('library.unnamed')

  return (
    <li className="collection-card glass">
      <button
        type="button"
        className="collection-open"
        aria-label={name}
        aria-describedby={detailsId}
        disabled={disabled}
        onClick={onOpen}
      >
        <span className="collection-cover">
          {item.coverPhotoId ? (
            <CoverPhoto photoId={item.coverPhotoId} />
          ) : (
            <EmptyFrameIllustration />
          )}
        </span>
        <span className="collection-name">{name}</span>
        <span className="collection-details" id={detailsId}>
          {details(item)}
        </span>
      </button>
      <Kebab
        label={t('card.options', { name })}
        disabled={disabled}
        items={[
          [
            { icon: Pencil, label: t('card.rename'), onClick: () => setSheet('rename') },
            { icon: Copy, label: t('card.duplicate'), onClick: onDuplicate },
            {
              icon: Trash2,
              label: t('card.delete'),
              onClick: () => setSheet('delete'),
              danger: true,
            },
          ],
        ]}
      />
      {sheet === 'rename' && (
        <RenameSheet
          title={t('card.renameTitle')}
          initial={item.name}
          onSave={onRename}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'delete' && (
        <ConfirmSheet
          title={t('card.deleteTitle', { name })}
          body={t('card.deleteBody')}
          confirmLabel={t('card.delete')}
          danger
          onConfirm={onDelete}
          onClose={() => setSheet(null)}
        />
      )}
    </li>
  )
}
