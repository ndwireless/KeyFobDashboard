import { useId } from 'react'

// Tip of the antenna in SVG coordinates (before the tilt); the waves converge here.
// styles.css uses the same point as the waves' transform-origin.
const TIP_X = 60
const TIP_Y = 10
const PIVOT_Y = 94
const TILT_DEG = -14
const WAVE_RADII = [16, 27, 38]

// Telescoping sections, bottom to top: [width, top y, bottom y]
const SECTIONS = [
  [6, 62, PIVOT_Y],
  [4.5, 37, 64],
  [3, TIP_Y, 39],
]

/**
 * Telescoping antenna on a hinged mount, standing on top of a panel. Each
 * time pulseKey changes, a set of waves travels in to the tip (the sensor
 * receiving a signal).
 */
export default function Antenna({ active, pulseKey }) {
  const metalId = useId()
  return (
    <div className={active ? 'antenna hot' : 'antenna'} aria-hidden="true">
      <svg viewBox="0 0 120 112" width="120" height="112">
        <defs>
          <linearGradient id={metalId} x1="0" x2="1">
            <stop offset="0" stopColor="#55595f" />
            <stop offset="0.45" stopColor="#d4d7dc" />
            <stop offset="1" stopColor="#55595f" />
          </linearGradient>
        </defs>

        <g transform={`rotate(${TILT_DEG} ${TIP_X} ${PIVOT_Y})`}>
          {/* Keyed so React remounts it, which restarts the CSS animation */}
          {pulseKey > 0 && (
            <g key={pulseKey}>
              {WAVE_RADII.map((r, i) => (
                <g key={r} className="wave" style={{ animationDelay: `${(WAVE_RADII.length - 1 - i) * 0.12}s` }}>
                  <path d={arc(r, -1)} />
                  <path d={arc(r, 1)} />
                </g>
              ))}
            </g>
          )}

          {SECTIONS.map(([width, top, bottom]) => (
            <g key={top}>
              <rect x={TIP_X - width / 2} y={top} width={width} height={bottom - top} rx={width / 2} fill={`url(#${metalId})`} />
              {/* Collar where the next section slides in */}
              <rect x={TIP_X - width / 2 - 1} y={top} width={width + 2} height="3" rx="1" fill="#8d9197" />
            </g>
          ))}
          <circle className="tip" cx={TIP_X} cy={TIP_Y} r="5" />
        </g>

        {/* Hinged mount with a status LED, sitting on the panel's top edge */}
        <rect x={TIP_X - 18} y={PIVOT_Y - 4} width="36" height="22" rx="5" fill="#2f3135" stroke="rgba(255,255,255,0.14)" />
        <circle cx={TIP_X} cy={PIVOT_Y} r="5" fill="#45484d" stroke="rgba(255,255,255,0.18)" />
        <circle className="led" cx={TIP_X + 11} cy={PIVOT_Y + 9} r="2.5" />
      </svg>
    </div>
  )
}

/** Arc of radius r around the tip, on the left (side = -1) or right (side = 1). */
function arc(r, side) {
  const angle = (50 * Math.PI) / 180
  const x = TIP_X + side * r * Math.cos(angle)
  const yTop = TIP_Y - r * Math.sin(angle)
  const yBottom = TIP_Y + r * Math.sin(angle)
  return `M ${x} ${yTop} A ${r} ${r} 0 0 ${side === 1 ? 1 : 0} ${x} ${yBottom}`
}
