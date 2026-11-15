import { ChevronLeft, Copy, CopyPlus, Pencil, Share, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useEditor } from '../../state/editor'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Kebab, type KebabItem } from '../components/Kebab'
import { RenameSheet } from '../components/RenameSheet'
import { t, type MessageKey } from '../i18n'
import { navigate } from '../router'

interface HeaderProps {
  /**
   * Runs what takes the editor off this collection (closing or deleting it), then shows the
   * list. Without a failure message, a failed action keeps the editor where it is and
   * resolves false.
   */
  onLeave: (action: () => Promise<void>, failure?: MessageKey) => Promise<boolean>
  onNotice: (text: string) => void
}

export function Header({ onLeave, onNotice }: HeaderProps) {
  const id = useEditor((s) => s.collection.id)
  const name = useEditor((s) => s.collection.name)
  const hasFrame = useEditor((s) => s.activeFrameId !== null)
  const editing = useEditor((s) => s.mode === 'edit')
  const exitEdit = useEditor((s) => s.exitEdit)
  const closeCollection = useEditor((s) => s.closeCollection)
  const renameCollection = useEditor((s) => s.renameCollection)
  const duplicateCollection = useEditor((s) => s.duplicateCollection)
  const deleteCollection = useEditor((s) => s.deleteCollection)
  const duplicateActive = useEditor((s) => s.duplicateActive)
  const removeActive = useEditor((s) => s.removeActive)
  const [sheet, setSheet] = useState<'rename' | 'delete' | 'removeFrame' | null>(null)
  /** Back, duplicate and delete run one at a time. */
  const [busy, setBusy] = useState(false)
  // Two taps before the next render would both see busy as false.
  const running = useRef(false)
  const shownName = name || t('library.unnamed')

  const run = async (action: () => Promise<void>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await action()
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const duplicate = () =>
    run(async () => {
      try {
        const copyId = await duplicateCollection(id)
        navigate({ name: 'editor', id: copyId })
      } catch (e) {
        console.error(e)
        onNotice(t('card.duplicateFailed'))
      }
    })

  const back = () =>
    run(async () => {
      if (!(await onLeave(closeCollection))) onNotice(t('header.backFailed'))
    })

  const collectionItems: KebabItem[] = [
    { icon: Pencil, label: t('card.rename'), onClick: () => setSheet('rename') },
    { icon: Copy, label: t('card.duplicate'), onClick: () => void duplicate(), disabled: busy },
    {
      icon: Trash2,
      label: t('card.delete'),
      onClick: () => setSheet('delete'),
      danger: true,
      disabled: busy,
    },
  ]
  const frameItems: KebabItem[] = [
    { icon: CopyPlus, label: t('header.frameDuplicate'), onClick: duplicateActive },
    {
      icon: Trash2,
      label: t('header.frameRemove'),
      onClick: () => setSheet('removeFrame'),
      danger: true,
    },
  ]

  return (
    <header className="header">
      <button
        type="button"
        className="icon-button header-back"
        aria-label={t('header.back')}
        disabled={busy}
        onClick={() => void back()}
      >
        <ChevronLeft size={26} />
      </button>
      <button
        type="button"
        className="header-name"
        aria-label={t('header.rename', { name: shownName })}
        onClick={() => setSheet('rename')}
      >
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
          aria-label={t('header.share')}
          onClick={() => {
            exitEdit()
            navigate({ name: 'share', id })
          }}
        >
          <Share size={21} />
        </button>
        <Kebab
          label={t('header.more')}
          items={hasFrame ? [collectionItems, frameItems] : [collectionItems]}
        />
      </div>
      {sheet === 'rename' && (
        <RenameSheet
          title={t('card.renameTitle')}
          initial={name}
          onSave={renameCollection}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'delete' && (
        <ConfirmSheet
          title={t('card.deleteTitle', { name: shownName })}
          body={t('card.deleteBody')}
          confirmLabel={t('card.delete')}
          danger
          onConfirm={() =>
            void run(async () => {
              await onLeave(() => deleteCollection(id), 'card.deleteFailed')
            })
          }
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'removeFrame' && (
        <ConfirmSheet
          title={t('header.frameRemoveTitle')}
          body={t('header.frameRemoveBody')}
          confirmLabel={t('header.frameRemoveConfirm')}
          danger
          onConfirm={removeActive}
          onClose={() => setSheet(null)}
        />
      )}
    </header>
  )
}
