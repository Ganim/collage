import { ChevronDown } from 'lucide-react'
import { useEditor } from '../../state/editor'
import { sizeChipText } from './sizeText'

/** The active frame's size, centred above it; tapping it changes the size. */
export function SizeSwitch({ onClick }: { onClick: () => void }) {
  const frame = useEditor((s) => s.collection.frames.find((f) => f.id === s.activeFrameId))
  if (!frame) return null
  return (
    <div className="size-switch-row">
      <button type="button" className="size-switch" onClick={onClick}>
        <span className="size-switch-pill glass">
          {sizeChipText(frame)}
          <ChevronDown size={16} aria-hidden="true" />
        </span>
      </button>
    </div>
  )
}
