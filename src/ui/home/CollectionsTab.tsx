import { FolderInput, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getEditorState, ImportNotOpenedError, useEditor } from '../../state/editor'
import { StorageFullError, type CollectionSummary } from '../../storage/store'
import { setCollectionLocalOnly } from '../../sync/localOnly'
import { useSyncStatus } from '../../sync/status'
import { t, type MessageKey } from '../i18n'
import { EmptyCollectionsIllustration } from '../illustrations'
import { SectionToolbar, ToolbarButton, ToolbarFileButton } from '../components/SectionToolbar'
import { CollectionCard } from './CollectionCard'

interface CollectionsTabProps {
  /** Shows a collection in the editor; it is already the one open when this is called. */
  onOpened: (id: string) => void
  /** Shows a collection in the editor, which opens it. */
  onOpen: (id: string) => void
}

export function CollectionsTab({ onOpened, onOpen }: CollectionsTabProps) {
  const bootstrap = useEditor((s) => s.bootstrap)
  const listCollections = useEditor((s) => s.listCollections)
  const newCollection = useEditor((s) => s.newCollection)
  const renameCollectionById = useEditor((s) => s.renameCollectionById)
  const duplicateCollection = useEditor((s) => s.duplicateCollection)
  const deleteCollection = useEditor((s) => s.deleteCollection)
  const importCollection = useEditor((s) => s.importCollection)
  /** Null until the first reading ends. */
  const [items, setItems] = useState<CollectionSummary[] | null>(null)
  const [listFailed, setListFailed] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)
  // Read again whenever the sync changed what is stored.
  const changeCount = useSyncStatus((s) => s.changeCount)

  const refresh = useCallback(async () => {
    try {
      setItems(await listCollections())
      setListFailed(false)
    } catch (e) {
      console.error(e)
      setListFailed(true)
    }
  }, [listCollections])

  useEffect(() => {
    let current = true
    listCollections()
      .then((list) => {
        if (current) setItems(list)
      })
      .catch((e: unknown) => {
        console.error(e)
        if (current) setListFailed(true)
      })
    return () => {
      current = false
    }
  }, [listCollections, changeCount])

  /** Runs one action at a time; a failure becomes the message on screen. */
  const run = async (action: () => Promise<void>, failure: (e: unknown) => MessageKey) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      console.error(e)
      setError(failure(e))
    } finally {
      setBusy(false)
    }
  }

  const retry = () =>
    run(
      async () => {
        // The same reading failed as the app started: the editor needs it to work too.
        if (getEditorState().loadFailed) await bootstrap()
        await refresh()
      },
      () => 'library.listFailed',
    )

  const create = () =>
    run(
      async () => onOpened(await newCollection()),
      () => 'library.newFailed',
    )

  const importFile = (file: File) =>
    run(
      async () => {
        try {
          await importCollection(file)
        } catch (e) {
          // It is stored even so: the list shows it.
          if (e instanceof ImportNotOpenedError) await refresh()
          throw e
        }
        onOpened(getEditorState().collection.id)
      },
      (e) =>
        e instanceof ImportNotOpenedError
          ? 'library.importNotOpened'
          : e instanceof StorageFullError
            ? 'library.importFull'
            : 'library.importInvalid',
    )

  const change = (action: () => Promise<unknown>, failure: MessageKey) =>
    run(
      async () => {
        try {
          await action()
        } finally {
          await refresh()
        }
      },
      () => failure,
    )

  if (listFailed) {
    return (
      <div className="home-message glass">
        <h2 role="alert">{t('library.listFailed')}</h2>
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => void retry()}
        >
          {t('library.retry')}
        </button>
      </div>
    )
  }

  if (items === null) return null

  const errorLine = error && (
    <p className="home-error" role="status">
      {t(error)}
    </p>
  )

  /** The empty state's link to import; the toolbar has its own button. */
  const importLink = (
    <label className={busy ? 'import-link import-link--busy' : 'import-link'}>
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
      <FolderInput size={18} aria-hidden="true" />
      {t('library.import')}
    </label>
  )

  if (items.length === 0) {
    return (
      <div className="home-message glass">
        <EmptyCollectionsIllustration />
        <h2>{t('library.emptyTitle')}</h2>
        <p>{t('library.emptyBody')}</p>
        {errorLine}
        <button
          type="button"
          className="primary-button home-message-action"
          disabled={busy}
          onClick={() => void create()}
        >
          {t('library.new')}
        </button>
        {importLink}
      </div>
    )
  }

  return (
    <>
      <SectionToolbar>
        <ToolbarFileButton
          icon={FolderInput}
          label={t('library.importShort')}
          accessibleLabel={t('library.import')}
          disabled={busy}
          onFile={(file) => void importFile(file)}
        />
        <ToolbarButton
          kind="primary"
          icon={Plus}
          label={t('library.new')}
          disabled={busy}
          onClick={() => void create()}
        />
      </SectionToolbar>
      {errorLine}
      <ul className="collection-grid">
        {items.map((item) => (
          <CollectionCard
            key={item.id}
            item={item}
            disabled={busy}
            onOpen={() => onOpen(item.id)}
            onRename={(name) =>
              void change(() => renameCollectionById(item.id, name), 'card.renameFailed')
            }
            onDuplicate={() =>
              void change(() => duplicateCollection(item.id), 'card.duplicateFailed')
            }
            onDelete={() => void change(() => deleteCollection(item.id), 'card.deleteFailed')}
            onSetLocalOnly={(localOnly) =>
              void change(() => setCollectionLocalOnly(item.id, localOnly), 'drive.failed')
            }
          />
        ))}
      </ul>
    </>
  )
}
