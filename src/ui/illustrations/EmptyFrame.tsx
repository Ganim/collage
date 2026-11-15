import { Blob, Drawing, Face, Sparkle, fuchsia, line, peach, plum, tint, white } from './parts'

/** An empty picture frame, smiling, ready for a photo. */
export function EmptyFrameIllustration() {
  return (
    <Drawing name="empty-frame">
      <Blob fill={peach} opacity={0.55} />
      <rect x="58" y="28" width="84" height="106" rx="10" fill={white} {...line} />
      <rect
        x="70"
        y="40"
        width="60"
        height="74"
        rx="5"
        fill={tint}
        stroke={plum}
        strokeWidth={2.2}
        strokeDasharray="6 7"
        strokeLinecap="round"
      />
      <Face x={100} y={74} size={0.9} />
      <circle cx="140" cy="130" r="13" fill={fuchsia} {...line} />
      <path d="M140 124v12M134 130h12" stroke={white} strokeWidth={3} strokeLinecap="round" />
      <Sparkle x={40} y={48} r={7} />
      <Sparkle x={166} y={50} r={5} />
    </Drawing>
  )
}
