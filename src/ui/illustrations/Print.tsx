import { Blob, Drawing, Face, Heart, Sparkle, fuchsia, line, lilac, peach, white } from './parts'

/** A friendly printer handing out a sheet with a photo at its true size. */
export function PrintIllustration() {
  return (
    <Drawing name="print">
      <Blob fill={peach} opacity={0.55} />
      <rect x="66" y="34" width="68" height="34" rx="5" fill={white} {...line} />
      <rect x="44" y="60" width="112" height="54" rx="16" fill={lilac} {...line} />
      <Face x={100} y={80} size={0.9} />
      <circle cx="140" cy="74" r="4" fill={fuchsia} />
      <path d="M60 104h80" {...line} />
      <g transform="rotate(-3 100 128)">
        <rect x="68" y="104" width="64" height="48" rx="4" fill={white} {...line} />
        <rect
          x="78"
          y="112"
          width="26"
          height="32"
          rx="3"
          fill={peach}
          stroke={fuchsia}
          strokeWidth={2}
        />
        <path
          d="M116 113h8M118 120h6M116 127h8M118 134h6M116 141h8"
          stroke={fuchsia}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </g>
      <Sparkle x={34} y={46} r={8} />
      <Sparkle x={170} y={40} r={6} />
      <Heart x={168} y={128} s={7} />
    </Drawing>
  )
}
