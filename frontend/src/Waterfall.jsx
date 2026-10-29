import { useEffect, useRef } from 'react'
import { MONO_FONT, MUTED, PLOT_PAD, fitCanvas } from './theme'

const ROW_PX = 2 // height of one waterfall row
const TICK_MS = 250 // a new row every tick, so all panels scroll at the same speed
// Segments older than this draw as empty (e.g. while the sensor is offline).
// Longer than one full BLE sweep (~6 s), so the BLE waterfall stays filled.
const STALE_S = 10
const COLOR_RANGE_dBm = [-105, -55]

// Signal strength -> color: dark screen, electric blue, neon cyan, white for the strongest
const COLOR_STOPS = [
  [0, [12, 14, 17]],
  [0.35, [0, 42, 128]],
  [0.6, [0, 102, 255]],
  [0.85, [0, 255, 255]],
  [1, [255, 255, 255]],
]
const COLOR_LUT = buildColorLUT(256)

/** Scrolling waterfall: time runs downward, color is signal strength. Newest row on top. */
export default function Waterfall({ band, spectra }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const [fmin, fmax] = band.plot_range_MHz

    function tick() {
      const { dpr } = fitCanvas(canvas)
      const left = Math.round(PLOT_PAD.left * dpr)
      const width = canvas.width - left - Math.round(PLOT_PAD.right * dpr)
      const height = canvas.height
      const row = Math.round(ROW_PX * dpr)
      if (width <= 0 || height <= row) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)

      // Scroll everything down one row
      ctx.drawImage(canvas, left, 0, width, height - row, left, row, width, height - row)

      // Newest row: strongest bin in each pixel column, from every fresh segment
      const columns = new Float32Array(width).fill(-Infinity)
      const spectrum = spectra.current.get(band.key)
      const now = Date.now() / 1000
      if (spectrum) {
        for (const segment of spectrum.segments.values()) {
          if (now - segment.time < STALE_S) maxIntoColumns(columns, segment, fmin, fmax)
        }
      }
      const image = ctx.createImageData(width, row)
      const [lo, hi] = COLOR_RANGE_dBm
      for (let c = 0; c < width; c++) {
        const t = columns[c] === -Infinity ? 0 : Math.min(1, Math.max(0, (columns[c] - lo) / (hi - lo)))
        const rgb = COLOR_LUT[Math.round(t * (COLOR_LUT.length - 1))]
        for (let r = 0; r < row; r++) {
          const i = (r * width + c) * 4
          image.data[i] = rgb[0]
          image.data[i + 1] = rgb[1]
          image.data[i + 2] = rgb[2]
          image.data[i + 3] = 255
        }
      }
      ctx.putImageData(image, left, 0)

      // Time labels in the left margin
      ctx.clearRect(0, 0, left, height)
      ctx.font = `${11 * dpr}px ${MONO_FONT}`
      ctx.fillStyle = MUTED
      ctx.textAlign = 'right'
      const historyS = Math.round(((height / row) * TICK_MS) / 1000)
      ctx.textBaseline = 'top'
      ctx.fillText('now', left - 6 * dpr, 2 * dpr)
      ctx.textBaseline = 'bottom'
      ctx.fillText(`-${historyS}s`, left - 6 * dpr, height - 2 * dpr)
    }

    const timer = setInterval(tick, TICK_MS)
    return () => clearInterval(timer)
  }, [band, spectra])

  return <canvas ref={canvasRef} className="waterfall" />
}

/** Max of each pixel column's bins; nearest bin when bins are wider than a column. */
function maxIntoColumns(columns, segment, fmin, fmax) {
  const n = segment.power.length
  const binWidth = (segment.f_stop - segment.f_start) / (n - 1)
  const colWidth = (fmax - fmin) / columns.length
  for (let c = 0; c < columns.length; c++) {
    const fa = fmin + c * colWidth
    const fb = fa + colWidth
    if (fb < segment.f_start || fa > segment.f_stop) continue
    let first = Math.max(0, Math.ceil((fa - segment.f_start) / binWidth))
    let last = Math.min(n - 1, Math.floor((fb - segment.f_start) / binWidth))
    if (last < first) {
      first = last = Math.min(n - 1, Math.max(0, Math.round((fa + colWidth / 2 - segment.f_start) / binWidth)))
    }
    let peak = -Infinity
    for (let i = first; i <= last; i++) peak = Math.max(peak, segment.power[i])
    columns[c] = Math.max(columns[c], peak)
  }
}

function buildColorLUT(size) {
  const lut = []
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1)
    let k = 0
    while (k < COLOR_STOPS.length - 2 && t > COLOR_STOPS[k + 1][0]) k++
    const [t0, c0] = COLOR_STOPS[k]
    const [t1, c1] = COLOR_STOPS[k + 1]
    const u = (t - t0) / (t1 - t0)
    lut.push(c0.map((v, j) => Math.round(v + (c1[j] - v) * u)))
  }
  return lut
}
