import { Blob, Drawing, Face, Heart, Sparkle, line, lilac, peach, tint, white } from './parts'

/** Photos settled into picture frames of different sizes. */
export function FramesIllustration() {
  return (
    <Drawing name="frames">
      <Blob fill={peach} opacity={0.55} />
      <g transform="rotate(-12 44 98)">
        <rect x="22" y="70" width="44" height="56" rx="6" fill={tint} {...line} />
        <rect x="31" y="79" width="26" height="30" rx="3" fill={lilac} />
      </g>
      <g transform="rotate(10 149 80)">
        <rect x="120" y="44" width="58" height="72" rx="7" fill={lilac} {...line} />
        <rect x="130" y="54" width="38" height="44" rx="4" fill={white} />
      </g>
      <g transform="rotate(-4 100 84)">
        <rect x="62" y="30" width="76" height="100" rx="8" fill={white} {...line} />
        <rect x="72" y="40" width="56" height="64" rx="4" fill={peach} />
        <path
          d="M72 96c10-12 20-12 28-4 9-9 20-9 28 2v6a4 4 0 0 1-4 4H76a4 4 0 0 1-4-4Z"
          fill={lilac}
        />
        <circle cx="100" cy="66" r="14" fill={white} {...line} strokeWidth={2.5} />
        <Face x={100} y={64} size={0.6} />
        <Heart x={100} y={117} s={6} />
      </g>
      <Sparkle x={42} y={40} r={8} />
      <Sparkle x={170} y={30} r={6} />
      <Sparkle x={182} y={132} r={5} />
    </Drawing>
  )
}
