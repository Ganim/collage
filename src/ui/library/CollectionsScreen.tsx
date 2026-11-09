import { FolderInput, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useEditor } from '../../state/editor'
import { StorageFullError, type CollectionSummary } from '../../storage/store'
import { BottomSheet } from '../components/BottomSheet'
import { t, type MessageKey } from '../i18n'

const details = (item: CollectionSummary) => {
  const frames =
    item.frameCount === 1
      ? t('library.framesOne')
      : t('library.framesMany', { count: item.frameCount })
  return `${frames} · ${new Date(item.updatedAt).toLocaleDateString('pt-BR')}`
}

export function CollectionsScreen({ onClose }: { onClose: () => void }) {
  const currentId = useEditor((s) => s.collection.id)
  const currentName = useEditor((s) => s.collection.name)
  const listCollections = useEditor((s) => s.listCollections)
  const renameCollection = useEditor((s) => s.renameCollection)
  const openCollection = useEditor((s) => s.openCollection)
  const newCollection = useEditor((s) => s.newCollection)
  const deleteCollection = useEditor((s) => s.deleteCollection)
  const importCollection = useEditor((s) => s.importCollection)
  const [items, setItems] = useState<CollectionSummary[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    listCollections()
      .then((list) => {
        if (current) setItems(list)
      })
      .catch((e: unknown) => {
        console.error(e)
        if (current) setError('library.listFailed')
      })
    return () => {
      current = false
    }
  }, [listCollections])

  /** Runs one action at a time; a failure becomes the message on screen. */
  const run = async (action: () => Promise<void>, failure: (e: unknown) => MessageKey) => {
    setBusy(true)
    setError(null)
    setConfirming(null)
    try {
      await action()
      return true
    } catch (e) {
      console.error(e)
      setError(failure(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const openAndClose = async (action: () => Promise<void>) => {
    if (await run(action, () => 'library.openFailed')) onClose()
  }

  const importFile = async (file: File) => {
    const done = await run(
      () => importCollection(file),
      (e) => (e instanceof StorageFullError ? 'library.importFull' : 'library.importInvalid'),
    )
    if (done) onClose()
  }

  const remove = async (id: string) => {
    if (confirming !== id) {
      setConfirming(id)
      return
    }
    await run(
      async () => {
        await deleteCollection(id)
        setItems(await listCollections())
      },
      () => 'library.deleteFailed',
    )
  }

  return (
    <BottomSheet title={t('library.title')} onClose={onClose}>
      <label className="library-name">
        {t('library.name')}
        <input type="text" value={currentName} onChange={(e) => renameCollection(e.target.value)} />
      </label>

      <ul className="library-list">
        {items.map((item) => {
          const isCurrent = item.id === currentId
          const name = isCurrent ? currentName : item.name
          const shownName = name || t('library.unnamed')
          const armed = confirming === item.id
          return (
            <li key={item.id} className="library-row">
              <button
                type="button"
                className="library-info"
                aria-current={isCurrent ? 'true' : undefined}
                disabled={busy}
                onClick={() =>
                  isCurrent ? onClose() : void openAndClose(() => openCollection(item.id))
                }
              >
                <span>{shownName}</span>
                <small>{details(item)}</small>
              </button>
              <button
                type="button"
                className={armed ? 'icon-button library-armed' : 'icon-button'}
                aria-label={t(armed ? 'library.deleteConfirm' : 'library.delete', {
                  name: shownName,
                })}
                disabled={busy}
                onClick={() => void remove(item.id)}
              >
                <Trash2 size={20} />
              </button>
            </li>
          )
        })}
      </ul>

      {error && (
        <p className="library-error" role="status">
          {t(error)}
        </p>
      )}

      <div className="library-actions">
        <button
          type="button"
          className="flip-button"
          disabled={busy}
          onClick={() => void openAndClose(newCollection)}
        >
          <Plus size={18} />
          {t('library.new')}
        </button>
        <label className="flip-button library-import">
          {/* No accept filter: iOS greys out file extensions it does not know. */}
          <input
            type="file"
            disabled={busy}
            aria-label={t('library.import')}
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Lets the same file be chosen again.
              e.target.value = ''
              if (file) void importFile(file)
            }}
          />
          <FolderInput size={18} />
          {t('library.import')}
        </label>
      </div>
    </BottomSheet>
  )
}
