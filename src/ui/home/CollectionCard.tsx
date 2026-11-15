import { Cloud, CloudOff, CloudUpload, Copy, Pencil, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { CollectionSummary } from '../../storage/store'
import { useDriveOn } from '../../sync/localOnly'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Kebab } from '../components/Kebab'
import { RenameSheet } from '../components/RenameSheet'
import { t } from '../i18n'
import { EmptyFrameIllustration } from '../illustrations'
import { usePhotoUrl } from '../usePhotoUrl'

const counts = (item: CollectionSummary) => {
  const frames =
    item.frameCount === 0
      ? t('library.framesNone')
      : item.frameCount === 1
        ? t('library.framesOne')
        : t('library.framesMany', { count: item.frameCount })
  const photos =
    item.photoCount === 0
      ? t('library.photosNone')
      : item.photoCount === 1
        ? t('library.photosOne')
        : t('library.photosMany', { count: item.photoCount })
  return `${frames} · ${photos}`
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
  /** Keeps the collection off the Drive (true) or sends it back to it (false). */
  onSetLocalOnly: (localOnly: boolean) => void
}

/** A collection on the list: its cover, pinned like a printed photo, its name and details. */
export function CollectionCard({
  item,
  disabled,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onSetLocalOnly,
}: CollectionCardProps) {
  const [sheet, setSheet] = useState<'rename' | 'delete' | 'removeDrive' | null>(null)
  const detailsId = useId()
  const name = item.name || t('library.unnamed')
  const driveOn = useDriveOn()

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
          {driveOn &&
            (item.localOnly ? (
              <CloudOff
                className="collection-drive-mark"
                size={14}
                role="img"
                aria-label={t('drive.localOnly')}
              />
            ) : (
              <Cloud
                className="collection-drive-mark"
                size={14}
                role="img"
                aria-label={t('drive.inAccount')}
              />
            ))}
        </span>
        <span className="collection-name">{name}</span>
        <span className="collection-details" id={detailsId}>
          <span>{counts(item)}</span>
          {driveOn && item.localOnly && <span>{t('drive.localOnly')}</span>}
          <span>{new Date(item.updatedAt).toLocaleDateString('pt-BR')}</span>
        </span>
      </button>
      <Kebab
        label={t('card.options', { name })}
        disabled={disabled}
        items={[
          [
            { icon: Pencil, label: t('card.rename'), onClick: () => setSheet('rename') },
            { icon: Copy, label: t('card.duplicate'), onClick: onDuplicate },
            ...(driveOn
              ? [
                  item.localOnly
                    ? {
                        icon: CloudUpload,
                        label: t('drive.send'),
                        onClick: () => onSetLocalOnly(false),
                      }
                    : {
                        icon: CloudOff,
                        label: t('drive.remove'),
                        onClick: () => setSheet('removeDrive'),
                      },
                ]
              : []),
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
      {sheet === 'removeDrive' && (
        <ConfirmSheet
          title={t('drive.removeTitle', { name })}
          body={t('drive.removeBody')}
          confirmLabel={t('drive.removeConfirm')}
          onConfirm={() => onSetLocalOnly(true)}
          onClose={() => setSheet(null)}
        />
      )}
    </li>
  )
}
