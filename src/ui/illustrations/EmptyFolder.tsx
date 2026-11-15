import { Blob, Drawing, Face, Sparkle, line, lilac, peach } from './parts'

/** A sleepy folder with nothing inside yet. */
export function EmptyFolderIllustration() {
  return (
    <Drawing name="empty-folder">
      <Blob fill={peach} opacity={0.55} />
      <path
        d="M46 56a8 8 0 0 1 8-8h28l10 10h54a8 8 0 0 1 8 8v58a8 8 0 0 1-8 8H54a8 8 0 0 1-8-8Z"
        fill={lilac}
        {...line}
      />
      <path
        d="M40 78a6 6 0 0 1 6-6h108a6 6 0 0 1 6 6l-6 48a7 7 0 0 1-7 6H53a7 7 0 0 1-7-6Z"
        fill={peach}
        {...line}
      />
      <Face x={100} y={100} size={0.95} sleepy />
      <path d="M150 36h10l-10 12h10" {...line} strokeWidth={2.5} fill="none" />
      <path d="M166 22h7l-7 8h7" {...line} strokeWidth={2.2} fill="none" />
      <Sparkle x={36} y={44} r={6} />
    </Drawing>
  )
}
