import { Blob, Drawing, Face, Heart, Sparkle, line, lilac, peach, white } from './parts'

/** A small fan of blank photo cards, waiting for the first collection. */
export function EmptyCollectionsIllustration() {
  return (
    <Drawing name="empty-collections">
      <Blob fill={lilac} opacity={0.6} />
      <rect
        x="66"
        y="40"
        width="68"
        height="84"
        rx="8"
        fill={peach}
        transform="rotate(-14 100 82)"
        {...line}
      />
      <rect
        x="66"
        y="40"
        width="68"
        height="84"
        rx="8"
        fill={lilac}
        transform="rotate(10 100 82)"
        {...line}
      />
      <g transform="rotate(-2 100 82)">
        <rect x="66" y="40" width="68" height="84" rx="8" fill={white} {...line} />
        <Face x={100} y={76} size={0.95} />
        <path d="M82 106h36" {...line} strokeWidth={2.5} opacity={0.3} />
      </g>
      <Heart x={152} y={40} s={8} />
      <Heart x={166} y={60} s={5} />
      <Sparkle x={42} y={50} r={7} />
      <Sparkle x={48} y={124} r={5} />
    </Drawing>
  )
}
