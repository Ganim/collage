import type { ReactNode, SVGProps } from 'react'

/** The token colors, the only ones the drawings use. */
export const ink = '#3b0a3f'
export const plum = '#7a4a7e'
export const fuchsia = '#c026d3'
export const fuchsiaDeep = '#a21caf'
export const pink = '#db2777'
export const tint = '#fdf4ff'
export const peach = '#fed7cc'
export const lilac = '#e9d5ff'
export const white = '#ffffff'

/** Rounded, slightly heavy strokes: the hand-drawn look every drawing shares. */
export const line = {
  stroke: ink,
  strokeWidth: 3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

interface DrawingProps {
  name: string
  viewBox?: string
  children: ReactNode
}

export function Drawing({ name, viewBox = '0 0 200 160', children }: DrawingProps) {
  return (
    <svg
      className="illustration"
      viewBox={viewBox}
      aria-hidden="true"
      focusable="false"
      data-illustration={name}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  )
}

/** Two dot eyes, a small smile and rosy cheeks, centred on (x, y). */
export function Face({
  x,
  y,
  size = 1,
  sleepy = false,
}: {
  x: number
  y: number
  size?: number
  sleepy?: boolean
}) {
  const s = size
  return (
    <g>
      {sleepy ? (
        <>
          <path
            d={`M${x - 10 * s} ${y} q${3 * s} ${3 * s} ${6 * s} 0`}
            {...line}
            strokeWidth={2.4 * s}
            fill="none"
          />
          <path
            d={`M${x + 4 * s} ${y} q${3 * s} ${3 * s} ${6 * s} 0`}
            {...line}
            strokeWidth={2.4 * s}
            fill="none"
          />
        </>
      ) : (
        <>
          <circle cx={x - 7 * s} cy={y} r={2.7 * s} fill={ink} />
          <circle cx={x + 7 * s} cy={y} r={2.7 * s} fill={ink} />
        </>
      )}
      <path
        d={`M${x - 4.5 * s} ${y + 6 * s} q${4.5 * s} ${4.5 * s} ${9 * s} 0`}
        {...line}
        strokeWidth={2.4 * s}
        fill="none"
      />
      <ellipse cx={x - 13 * s} cy={y + 6 * s} rx={4 * s} ry={2.6 * s} fill={pink} opacity={0.3} />
      <ellipse cx={x + 13 * s} cy={y + 6 * s} rx={4 * s} ry={2.6 * s} fill={pink} opacity={0.3} />
    </g>
  )
}

/** A four-point twinkle. */
export function Sparkle({
  x,
  y,
  r = 7,
  fill = fuchsia,
}: {
  x: number
  y: number
  r?: number
  fill?: string
}) {
  const k = r * 0.22
  return (
    <path
      d={`M${x} ${y - r} C${x + k} ${y - k} ${x + k} ${y - k} ${x + r} ${y} C${x + k} ${y + k} ${x + k} ${y + k} ${x} ${y + r} C${x - k} ${y + k} ${x - k} ${y + k} ${x - r} ${y} C${x - k} ${y - k} ${x - k} ${y - k} ${x} ${y - r}Z`}
      fill={fill}
    />
  )
}

export function Heart({
  x,
  y,
  s = 8,
  fill = pink,
  ...rest
}: { x: number; y: number; s?: number; fill?: string } & SVGProps<SVGPathElement>) {
  return (
    <path
      d={`M${x} ${y + s * 0.9} C${x - s * 1.5} ${y} ${x - s * 0.9} ${y - s} ${x} ${y - s * 0.35} C${x + s * 0.9} ${y - s} ${x + s * 1.5} ${y} ${x} ${y + s * 0.9}Z`}
      fill={fill}
      {...rest}
    />
  )
}

/** A soft, uneven blob behind each drawing. */
export function Blob({ fill = lilac, opacity = 0.7 }: { fill?: string; opacity?: number }) {
  return (
    <path
      d="M38 92C30 58 56 26 96 22c42-4 72 18 74 52 2 36-22 62-62 66-40 4-62-14-70-48Z"
      fill={fill}
      opacity={opacity}
    />
  )
}
