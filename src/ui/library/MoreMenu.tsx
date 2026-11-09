import { Copy, FileDown, FolderOpen, Ruler, Trash2, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useEditor } from '../../state/editor'
import { BottomSheet } from '../components/BottomSheet'
import { t } from '../i18n'
import { deliverFile, safeFileName } from '../sheet/deliver'

const COLLECTION_TYPE = 'application/octet-stream'

interface MenuRowProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}

function MenuRow({ icon: Icon, label, onClick, disabled }: MenuRowProps) {
  return (
    <li>
      <button type="button" className="menu-row" onClick={onClick} disabled={disabled}>
        <Icon size={22} />
        {label}
      </button>
    </li>
  )
}

interface MoreMenuProps {
  onClose: () => void
  onCollections: () => void
  onSizes: () => void
}

export function MoreMenu({ onClose, onCollections, onSizes }: MoreMenuProps) {
  const hasFrame = useEditor((s) => s.activeFrameId !== null)
  const name = useEditor((s) => s.collection.name)
  const exportActive = useEditor((s) => s.exportActive)
  const duplicateActive = useEditor((s) => s.duplicateActive)
  const removeActive = useEditor((s) => s.removeActive)
  const [building, setBuilding] = useState(false)
  // Built first and delivered on a second tap: iOS only shares right after a touch.
  const [bundle, setBundle] = useState<Blob | null>(null)
  const [failed, setFailed] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const build = async () => {
    setBuilding(true)
    setFailed(false)
    try {
      setBundle(await exportActive())
    } catch (e) {
      console.error(e)
      setFailed(true)
    } finally {
      setBuilding(false)
    }
  }

  const deliver = async (blob: Blob) => {
    setFailed(false)
    try {
      const result = await deliverFile(blob, safeFileName(name, 'collage'), COLLECTION_TYPE)
      if (result !== 'cancelled') onClose()
    } catch (e) {
      console.error(e)
      setFailed(true)
    }
  }

  const remove = () => {
    if (!confirmingRemove) {
      setConfirmingRemove(true)
      return
    }
    removeActive()
    onClose()
  }

  return (
    <BottomSheet title={t('more.title')} onClose={onClose}>
      <ul className="menu-list">
        <MenuRow icon={FolderOpen} label={t('more.collections')} onClick={onCollections} />
        {bundle ? (
          <MenuRow icon={FileDown} label={t('more.deliver')} onClick={() => void deliver(bundle)} />
        ) : (
          <MenuRow
            icon={FileDown}
            label={building ? t('more.building') : t('more.save')}
            onClick={() => void build()}
            disabled={building}
          />
        )}
        <MenuRow icon={Ruler} label={t('more.sizes')} onClick={onSizes} />
        {hasFrame && (
          <>
            <MenuRow
              icon={Copy}
              label={t('more.duplicate')}
              onClick={() => {
                duplicateActive()
                onClose()
              }}
            />
            <MenuRow
              icon={Trash2}
              label={confirmingRemove ? t('more.removeConfirm') : t('more.remove')}
              onClick={remove}
            />
          </>
        )}
      </ul>
      {failed && (
        <p className="library-error" role="status">
          {t('more.saveFailed')}
        </p>
      )}
    </BottomSheet>
  )
}
