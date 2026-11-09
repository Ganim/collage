import {
  BringToFront,
  ImagePlus,
  Replace,
  RotateCw,
  Ruler,
  SendToBack,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { ACCEPT } from '../../photos/import'
import { useEditor } from '../../state/editor'
import { t } from '../i18n'

interface ActionProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}

function Action({ icon: Icon, label, onClick, disabled }: ActionProps) {
  return (
    <button type="button" className="action" onClick={onClick} disabled={disabled}>
      <Icon size={22} />
      <span>{label}</span>
    </button>
  )
}

interface ActionBarProps {
  /** A photo is being read: acting on the selection now would race with placing it. */
  busy: boolean
  onSize: () => void
  onAdd: (files: File[]) => void
}

export function ActionBar({ busy, onSize, onAdd }: ActionBarProps) {
  const frame = useEditor((s) => s.collection.frames.find((f) => f.id === s.activeFrameId))
  const layers = frame?.layers ?? []
  const selectedId = useEditor((s) => s.selectedLayerId)
  const startReplace = useEditor((s) => s.startReplace)
  const rotateSelected = useEditor((s) => s.rotateSelected)
  const moveSelected = useEditor((s) => s.moveSelected)
  const removeSelected = useEditor((s) => s.removeSelected)
  const index = layers.findIndex((l) => l.id === selectedId)

  return (
    <div className="action-bar" role="toolbar" aria-label={t('actions.label')}>
      <Action icon={Replace} label={t('action.replace')} onClick={startReplace} disabled={busy} />
      <Action icon={Ruler} label={t('action.size')} onClick={onSize} />
      <Action icon={RotateCw} label={t('action.rotate')} onClick={rotateSelected} />
      <label className={busy ? 'action action--disabled' : 'action'}>
        <input
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            // Lets the same file be chosen again.
            e.target.value = ''
            if (files.length > 0) onAdd(files)
          }}
        />
        <ImagePlus size={22} />
        <span>{t('action.add')}</span>
      </label>
      {index > 0 && (
        <>
          <Action
            icon={BringToFront}
            label={t('action.forward')}
            onClick={() => moveSelected('forward')}
            disabled={index === layers.length - 1}
          />
          <Action
            icon={SendToBack}
            label={t('action.back')}
            onClick={() => moveSelected('back')}
            disabled={index === 1}
          />
        </>
      )}
      <Action icon={Trash2} label={t('action.remove')} onClick={removeSelected} />
    </div>
  )
}
