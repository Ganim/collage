import { Blob, Drawing, Face, Sparkle, fuchsia, line, lilac, peach, tint, white } from './parts'

function Fingertip({ x, y, turn }: { x: number; y: number; turn: number }) {
  return (
    <g transform={`rotate(${turn} ${x} ${y})`}>
      <rect x={x - 12} y={y} width="24" height="54" rx="12" fill={tint} {...line} />
      <path d={`M${x - 6} ${y + 9}q6-5 12 0`} {...line} strokeWidth={2.4} fill="none" />
    </g>
  )
}

/** Two fingertips stretching a photo: adjusting it by hand. */
export function WelcomeIllustration() {
  return (
    <Drawing name="welcome" viewBox="-10 -26 220 216">
      <Blob fill={lilac} opacity={0.6} />
      <g transform="rotate(-3 100 78)">
        <rect x="54" y="36" width="92" height="84" rx="8" fill={white} {...line} />
        <rect x="63" y="45" width="74" height="66" rx="5" fill={lilac} />
        <circle cx="100" cy="82" r="22" fill={peach} {...line} strokeWidth={2.5} />
        <Face x={100} y={79} size={0.85} />
        <circle cx="54" cy="36" r="5" fill={white} stroke={fuchsia} strokeWidth={2.5} />
        <circle cx="146" cy="120" r="5" fill={white} stroke={fuchsia} strokeWidth={2.5} />
      </g>
      <Fingertip x={156} y={124} turn={-35} />
      <Fingertip x={44} y={32} turn={145} />
      <path
        d="M172 102q8 4 10 12"
        stroke={fuchsia}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M28 58q-8-4-10-12"
        stroke={fuchsia}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
      <Sparkle x={168} y={34} r={7} />
      <Sparkle x={30} y={124} r={6} />
    </Drawing>
  )
}
