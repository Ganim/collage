import { Blob, Drawing, Face, Sparkle, fuchsia, line, lilac, peach, pink } from './parts'

/** A wrapped present: something nice on the way. */
export function ComingSoonIllustration() {
  return (
    <Drawing name="coming-soon">
      <Blob fill={lilac} opacity={0.6} />
      <rect x="60" y="78" width="80" height="56" rx="8" fill={lilac} {...line} />
      <rect x="54" y="62" width="92" height="20" rx="6" fill={peach} {...line} />
      <rect x="94" y="63.5" width="12" height="17" fill={fuchsia} />
      <path d="M100 62c-6-16-26-20-26-8 0 8 14 9 26 8Z" fill={pink} {...line} strokeWidth={2.5} />
      <path d="M100 62c6-16 26-20 26-8 0 8-14 9-26 8Z" fill={pink} {...line} strokeWidth={2.5} />
      <Face x={100} y={102} size={0.95} />
      <Sparkle x={40} y={56} r={8} />
      <Sparkle x={164} y={44} r={6} />
      <Sparkle x={160} y={120} r={5} />
    </Drawing>
  )
}
