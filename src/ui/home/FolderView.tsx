import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { SizePreset } from '../../core/presets'
import type { SavedSize, Size } from '../../core/types'
import { useEditor } from '../../state/editor'
import { sizeListText } from '../build/sizeText'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Kebab } from '../components/Kebab'
import { RenameSheet } from '../components/RenameSheet'
import { t, type MessageKey } from '../i18n'
import { EmptyFolderIllustration } from '../illustrations'
import { navigate, routeHash } from '../router'
import { DEFAULTS_ID, isPreset, type SizeGroup } from './folders'
import { SizeForm } from './SizeForm'

const THUMB_PX = 40

/** A glass rectangle in the size's proportion. */
function SizeThumb({ size }: { size: Size }) {
  const scale = THUMB_PX / Math.max(size.widthMm, size.heightMm)
  return (
    <span className="size-thumb" aria-hidden="true">
      <span
        className="size-thumb-shape"
        style={{ width: size.widthMm * scale, height: size.heightMm * scale }}
      />
    </span>
  )
}

type Sheet =
  | { kind: 'renameFolder' }
  | { kind: 'deleteFolder' }
  | { kind: 'newSize' }
  | { kind: 'editSize'; size: SavedSize }
  | { kind: 'deleteSize'; size: SavedSize }

/** The sizes of one folder; only the user's folders and sizes can change. */
export function FolderView({ group }: { group: SizeGroup }) {
  const renameFolder = useEditor((s) => s.renameFolder)
  const deleteFolder = useEditor((s) => s.deleteFolder)
  const deleteSize = useEditor((s) => s.deleteSize)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const readOnly = group.id === DEFAULTS_ID
  const close = () => setSheet(null)

  const run = async (action: () => Promise<void>, failure: MessageKey) => {
    setError(null)
    try {
      await action()
    } catch (e) {
      console.error(e)
      setError(failure)
    }
  }

  const newSizeButton = (className: string) => (
    <button type="button" className={className} onClick={() => setSheet({ kind: 'newSize' })}>
      <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
      {t('frames.newSize')}
    </button>
  )

  const row = (size: SavedSize | SizePreset) => {
    const preset = isPreset(size)
    const name = preset ? sizeListText(size) : size.name
    return (
      <li key={size.id} className="size-row glass">
        <SizeThumb size={size} />
        <span className="size-row-text">
          <span className="size-row-name">{name}</span>
          {!preset && <span className="size-row-measure">{sizeListText(size)}</span>}
        </span>
        {!preset && (
          <Kebab
            label={t('frames.sizeOptions', { name })}
            items={[
              [
                {
                  icon: Pencil,
                  label: t('frames.editSize'),
                  onClick: () => setSheet({ kind: 'editSize', size }),
                },
                {
                  icon: Trash2,
                  label: t('frames.deleteSize'),
                  onClick: () => setSheet({ kind: 'deleteSize', size }),
                  danger: true,
                },
              ],
            ]}
          />
        )}
      </li>
    )
  }

  return (
    <>
      <div className="folder-header">
        <a
          className="icon-button"
          href={routeHash({ name: 'frames' })}
          aria-label={t('frames.back')}
        >
          <ChevronLeft size={26} />
        </a>
        <h2 className="folder-title">{group.name}</h2>
        {!group.fixed && (
          <Kebab
            label={t('frames.folderOptions', { name: group.name })}
            items={[
              [
                {
                  icon: Pencil,
                  label: t('frames.renameFolder'),
                  onClick: () => setSheet({ kind: 'renameFolder' }),
                },
                {
                  icon: Trash2,
                  label: t('frames.deleteFolder'),
                  onClick: () => setSheet({ kind: 'deleteFolder' }),
                  danger: true,
                },
              ],
            ]}
          />
        )}
      </div>
      {error && (
        <p className="home-error" role="status">
          {t(error)}
        </p>
      )}
      {group.sizes.length === 0 ? (
        <div className="home-message glass">
          <EmptyFolderIllustration />
          <h2>{t('frames.emptyTitle')}</h2>
          {newSizeButton('primary-button home-message-action')}
        </div>
      ) : (
        <>
          <ul className="size-list">{group.sizes.map(row)}</ul>
          {!readOnly && <div className="folder-footer">{newSizeButton('primary-button')}</div>}
        </>
      )}

      {sheet?.kind === 'renameFolder' && (
        <RenameSheet
          title={t('frames.renameFolderTitle')}
          initial={group.name}
          onSave={(name) => void run(() => renameFolder(group.id, name), 'frames.folderFailed')}
          onClose={close}
        />
      )}
      {sheet?.kind === 'deleteFolder' && (
        <ConfirmSheet
          title={t('frames.deleteFolderTitle', { name: group.name })}
          body={t('frames.deleteFolderBody')}
          confirmLabel={t('frames.deleteFolder')}
          danger
          onConfirm={() =>
            void run(async () => {
              await deleteFolder(group.id)
              navigate({ name: 'frames' }, { replace: true })
            }, 'frames.deleteFolderFailed')
          }
          onClose={close}
        />
      )}
      {sheet?.kind === 'newSize' && <SizeForm folderId={group.id} onClose={close} />}
      {sheet?.kind === 'editSize' && <SizeForm editing={sheet.size} onClose={close} />}
      {sheet?.kind === 'deleteSize' && (
        <ConfirmSheet
          title={t('frames.deleteSizeTitle', { name: sheet.size.name })}
          body={t('frames.deleteSizeBody')}
          confirmLabel={t('frames.deleteSize')}
          danger
          onConfirm={() => {
            const { id } = sheet.size
            void run(() => deleteSize(id), 'frames.deleteSizeFailed')
          }}
          onClose={close}
        />
      )}
    </>
  )
}
