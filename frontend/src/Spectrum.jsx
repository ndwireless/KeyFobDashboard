import { useEffect, useRef } from 'react'
import { AFTERGLOW_S } from './useScanner'
import { ELECTRIC_BLUE, MONO_FONT, MUTED, NEON_CYAN, PLOT_PAD, WHITE, fitCanvas, withAlpha } from './theme'

const X_DIVS = 10
const Y_DIVS = 8

/** Analyzer-style spectrum screen: graticule, glowing live trace, afterglow, peak hold. */
export default function Spectrum({ band, spectra, yRange, active }) {
  const canvasRef = useRef(null)
  // Read inside the draw loop, so a detection doesn't restart the loop
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const [fmin, fmax] = band.plot_range_MHz
    const [ymin, ymax] = yRange
    let frame

    function draw() {
      frame = requestAnimationFrame(draw)
      const { width, height, dpr } = fitCanvas(canvas)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const plot = {
        x: PLOT_PAD.left,
        y: PLOT_PAD.top,
        w: width - PLOT_PAD.left - PLOT_PAD.right,
        h: height - PLOT_PAD.top - PLOT_PAD.bottom,
      }
      const fx = (f) => plot.x + ((f - fmin) / (fmax - fmin)) * plot.w
      const py = (p) => plot.y + ((ymax - Math.min(ymax, Math.max(ymin, p))) / (ymax - ymin)) * plot.h
      const color = activeRef.current ? NEON_CYAN : ELECTRIC_BLUE

      drawGraticule(ctx, plot)

      // Shaded columns where we listen for a transmission
      ctx.fillStyle = withAlpha(WHITE, 0.05)
      for (const [lo, hi] of band.detect_ranges_MHz) {
        ctx.fillRect(fx(lo), plot.y, fx(hi) - fx(lo), plot.h)
      }

      const spectrum = spectra.current.get(band.key)
      if (spectrum) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(plot.x, plot.y, plot.w, plot.h)
        ctx.clip()

        // Afterglow: recent traces fading out, like phosphor on an old analyzer
        const now = Date.now() / 1000
        ctx.lineWidth = 1
        for (const trace of spectrum.afterglow.slice(0, -1)) {
          const fade = 1 - (now - trace.time) / AFTERGLOW_S
          if (fade <= 0) continue
          ctx.strokeStyle = withAlpha(color, 0.3 * fade)
          strokeTrace(ctx, trace, trace.power, fx, py)
        }

        // Peak hold
        ctx.setLineDash([2, 3])
        ctx.strokeStyle = withAlpha(color, 0.45)
        for (const segment of spectrum.segments.values()) strokeTrace(ctx, segment, segment.hold, fx, py)
        ctx.setLineDash([])

        // Live trace
        ctx.lineWidth = 1.5
        ctx.strokeStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = 8
        for (const segment of spectrum.segments.values()) strokeTrace(ctx, segment, segment.power, fx, py)
        ctx.restore()
      }

      // Readouts, placed like an analyzer's: reference level and scale on top,
      // center frequency and span below
      ctx.font = `11px ${MONO_FONT}`
      ctx.fillStyle = MUTED
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      ctx.fillText(`Ref ${ymax} dBm`, plot.x, plot.y - 8)
      ctx.fillText(`Center ${((fmin + fmax) / 2).toFixed(2)} MHz`, plot.x, height - 8)
      ctx.textAlign = 'right'
      ctx.fillText(`${(ymax - ymin) / Y_DIVS} dB/div`, plot.x + plot.w, plot.y - 8)
      ctx.fillText(`Span ${fmax - fmin} MHz`, plot.x + plot.w, height - 8)
      ctx.textBaseline = 'middle'
      for (let i = 0; i <= Y_DIVS; i += 2) {
        const p = ymax - (i * (ymax - ymin)) / Y_DIVS
        ctx.fillText(String(p), plot.x - 6, py(p))
      }
    }

    draw()
    return () => cancelAnimationFrame(frame)
  }, [band, spectra, yRange])

  return <canvas ref={canvasRef} className="spectrum" />
}

function drawGraticule(ctx, plot) {
  ctx.lineWidth = 1
  ctx.strokeStyle = withAlpha(WHITE, 0.07)
  ctx.beginPath()
  for (let i = 1; i < X_DIVS; i++) {
    const x = Math.round(plot.x + (i * plot.w) / X_DIVS) + 0.5
    ctx.moveTo(x, plot.y)
    ctx.lineTo(x, plot.y + plot.h)
  }
  for (let i = 1; i < Y_DIVS; i++) {
    const y = Math.round(plot.y + (i * plot.h) / Y_DIVS) + 0.5
    ctx.moveTo(plot.x, y)
    ctx.lineTo(plot.x + plot.w, y)
  }
  ctx.stroke()

  // Minor ticks along the center lines, 5 per division
  const cx = Math.round(plot.x + plot.w / 2) + 0.5
  const cy = Math.round(plot.y + plot.h / 2) + 0.5
  ctx.strokeStyle = withAlpha(WHITE, 0.16)
  ctx.beginPath()
  for (let i = 1; i < X_DIVS * 5; i++) {
    const x = Math.round(plot.x + (i * plot.w) / (X_DIVS * 5)) + 0.5
    ctx.moveTo(x, cy - 3)
    ctx.lineTo(x, cy + 3)
  }
  for (let i = 1; i < Y_DIVS * 5; i++) {
    const y = Math.round(plot.y + (i * plot.h) / (Y_DIVS * 5)) + 0.5
    ctx.moveTo(cx - 3, y)
    ctx.lineTo(cx + 3, y)
  }
  ctx.stroke()

  ctx.strokeStyle = withAlpha(WHITE, 0.2)
  ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1)
}

function strokeTrace(ctx, segment, values, fx, py) {
  const n = values.length
  const step = n > 1 ? (segment.f_stop - segment.f_start) / (n - 1) : 0
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = fx(segment.f_start + i * step)
    const y = py(values[i])
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}
