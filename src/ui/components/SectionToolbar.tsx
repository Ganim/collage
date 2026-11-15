import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** The row of actions under a section's title: secondary buttons first, the primary last. */
export function SectionToolbar({ children }: { children: ReactNode }) {
  return <div className="section-toolbar">{children}</div>
}

interface ToolbarButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  kind: 'primary' | 'secondary'
  icon: LucideIcon
  label: string
}

export function ToolbarButton({
  kind,
  icon: Icon,
  label,
  type = 'button',
  ...rest
}: ToolbarButtonProps) {
  return (
    <button type={type} className={`toolbar-button ${kind}-button`} {...rest}>
      <Icon size={18} strokeWidth={kind === 'primary' ? 2.5 : 2} aria-hidden="true" />
      {label}
    </button>
  )
}

interface ToolbarFileButtonProps {
  icon: LucideIcon
  label: string
  /** The accessible name of the file input. */
  accessibleLabel: string
  disabled?: boolean
  onFile: (file: File) => void
}

/** A secondary toolbar button that opens the file picker. */
export function ToolbarFileButton({
  icon: Icon,
  label,
  accessibleLabel,
  disabled,
  onFile,
}: ToolbarFileButtonProps) {
  return (
    <label
      className={`toolbar-button secondary-button toolbar-file${disabled ? ' toolbar-file--busy' : ''}`}
    >
      {/* No accept filter: iOS greys out file extensions it does not know. */}
      <input
        type="file"
        disabled={disabled}
        aria-label={accessibleLabel}
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Lets the same file be chosen again.
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
      <Icon size={18} aria-hidden="true" />
      {label}
    </label>
  )
}
