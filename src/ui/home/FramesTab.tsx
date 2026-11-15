import { Folder, FolderPlus, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { useEditor } from '../../state/editor'
import { SectionToolbar, ToolbarButton } from '../components/SectionToolbar'
import { RenameSheet } from '../components/RenameSheet'
import { t } from '../i18n'
import { navigate, routeHash } from '../router'
import { FolderView } from './FolderView'
import { groupSizes, type SizeGroup } from './folders'
import { SizeForm } from './SizeForm'

const sizeCount = (count: number) =>
  count === 0
    ? t('frames.sizesNone')
    : count === 1
      ? t('frames.sizesOne')
      : t('frames.sizesMany', { count })

function FolderCard({ group }: { group: SizeGroup }) {
  const countId = useId()
  return (
    <li className="folder-card glass">
      <a
        className="folder-open"
        href={routeHash({ name: 'frames', folderId: group.id })}
        aria-label={group.name}
        aria-describedby={countId}
      >
        <span className="folder-icon" aria-hidden="true">
          <Folder size={30} strokeWidth={2} />
        </span>
        <span className="folder-name">{group.name}</span>
        <span className="folder-count" id={countId}>
          {sizeCount(group.sizes.length)}
        </span>
      </a>
    </li>
  )
}

/** The size folders, or the one the route names. */
export function FramesTab({ folderId }: { folderId?: string }) {
  const folders = useEditor((s) => s.folders)
  const savedSizes = useEditor((s) => s.savedSizes)
  const saveFolder = useEditor((s) => s.saveFolder)
  const [sheet, setSheet] = useState<'folder' | 'size' | null>(null)
  const [failed, setFailed] = useState(false)

  const groups = groupSizes(folders, savedSizes)
  const open = groups.find((g) => g.id === folderId)
  if (open) return <FolderView key={open.id} group={open} />

  const createFolder = async (name: string) => {
    setFailed(false)
    try {
      const folder = await saveFolder(name)
      navigate({ name: 'frames', folderId: folder.id })
    } catch (e) {
      console.error(e)
      setFailed(true)
    }
  }

  return (
    <>
      <SectionToolbar>
        <ToolbarButton
          kind="secondary"
          icon={FolderPlus}
          label={t('frames.newFolder')}
          onClick={() => setSheet('folder')}
        />
        <ToolbarButton
          kind="primary"
          icon={Plus}
          label={t('frames.newSizeShort')}
          aria-label={t('frames.newSize')}
          onClick={() => setSheet('size')}
        />
      </SectionToolbar>
      {failed && (
        <p className="home-error" role="status">
          {t('frames.folderFailed')}
        </p>
      )}
      <ul className="folder-grid">
        {groups.map((group) => (
          <FolderCard key={group.id} group={group} />
        ))}
      </ul>
      {sheet === 'folder' && (
        <RenameSheet
          title={t('frames.newFolder')}
          initial=""
          onSave={(name) => void createFolder(name)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'size' && <SizeForm onClose={() => setSheet(null)} />}
    </>
  )
}
