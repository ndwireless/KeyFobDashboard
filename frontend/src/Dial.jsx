import { useEffect, useId, useRef } from 'react'

const SWEEP_DEG = 270 // knob travel, centered on straight up
const LED_COUNT = 24
const KNURL_COUNT = 32
const PX_PER_dB = 3 // vertical drag distance per dB

/**
 * Radio-style knob that sets a detection threshold. The LED ring around it is
 * a level meter: lit up to the band's latest measured power, brighter where
 * that power is past the threshold (a detection). Drag up/down, scroll, or
 * use the arrow keys.
 */
export default function Dial({ label, value, level, range, onChange }) {
  const [min, max] = range
  const svgRef = useRef(null)
  const drag = useRef(null)
  const gradientId = useId()

  // Latest value, so several events between renders (fast scrolling) all count
  const current = useRef(value)
  current.current = value

  const clamp = (v) => Math.min(max, Math.max(min, Math.round(v)))
  const angle = (v) => -SWEEP_DEG / 2 + (SWEEP_DEG * (Math.min(max, Math.max(min, v)) - min)) / (max - min)
  const change = (v) => {
    const next = clamp(v)
    if (next === current.current) return
    current.current = next
    onChange(next)
  }

  // Wheel needs a non-passive listener so it can stop the page from scrolling
  const changeRef = useRef(change)
  changeRef.current = change
  useEffect(() => {
    const svg = svgRef.current
    function onWheel(event) {
      event.preventDefault()
      changeRef.current(current.current + (event.deltaY < 0 ? 1 : -1))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  function onPointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { y: event.clientY, value }
  }
  function onPointerMove(event) {
    if (drag.current) change(drag.current.value + (drag.current.y - event.clientY) / PX_PER_dB)
  }
  function onPointerUp() {
    drag.current = null
  }
  function onKeyDown(event) {
    const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }
    if (event.key in steps) change(current.current + steps[event.key])
    else if (event.key === 'Home') change(min)
    else if (event.key === 'End') change(max)
    else return
    event.preventDefault()
  }

  const leds = Array.from({ length: LED_COUNT }, (_, i) => {
    const dB = min + ((i + 0.5) * (max - min)) / LED_COUNT
    let className = 'dial-led'
    if (level != null && dB <= level) className += dB > value ? ' lit over' : ' lit'
    return <rect key={i} className={className} x="58.5" y="5" width="3" height="8" rx="1.5" transform={`rotate(${angle(dB)} 60 60)`} />
  })

  return (
    <div className="dial">
      <div className="dial-readout">
        <span className="dial-value">{formatdBm(value)}</span>
        <span className="dial-label">Threshold</span>
      </div>
      <svg
        ref={svgRef}
        className="dial-knob"
        viewBox="0 0 120 120"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatdBm(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <defs>
          <radialGradient id={`${gradientId}-body`} cx="0.4" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#5a5e65" />
            <stop offset="1" stopColor="#202226" />
          </radialGradient>
          <linearGradient id={`${gradientId}-cap`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9a9ea5" />
            <stop offset="0.5" stopColor="#4b4f55" />
            <stop offset="1" stopColor="#2b2d31" />
          </linearGradient>
        </defs>

        {/* Recessed faceplate the LEDs sit in */}
        <circle className="dial-plate" cx="60" cy="60" r="59" />
        {leds}
        <text className="dial-scale" x="24" y="112" textAnchor="middle">{min}</text>
        <text className="dial-scale" x="96" y="112" textAnchor="middle">{max}</text>

        {/* Knob: skirt, knurled grip, and cap. Only the grip and pointer turn, so the lighting stays put. */}
        <circle cx="60" cy="60" r="40" fill="#141518" />
        <circle cx="60" cy="60" r="37" fill={`url(#${gradientId}-body)`} stroke="rgba(255,255,255,0.12)" />
        <g transform={`rotate(${angle(value)} 60 60)`}>
          {Array.from({ length: KNURL_COUNT }, (_, i) => (
            <line key={i} x1="60" y1="24" x2="60" y2="29" className="dial-knurl" transform={`rotate(${(360 * i) / KNURL_COUNT} 60 60)`} />
          ))}
        </g>
        <circle cx="60" cy="60" r="26" fill={`url(#${gradientId}-cap)`} stroke="rgba(0,0,0,0.5)" />
        <g transform={`rotate(${angle(value)} 60 60)`}>
          <rect className="dial-pointer" x="57.5" y="37" width="5" height="15" rx="2.5" />
        </g>
      </svg>
    </div>
  )
}

function formatdBm(value) {
  return `${value < 0 ? '−' : ''}${Math.abs(Math.round(value))} dBm`
}
