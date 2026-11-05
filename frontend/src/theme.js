// Tech Innovation theme (skills/skills/theme-factory/themes/tech-innovation.md),
// shared by the canvases. styles.css mirrors these as CSS variables.
export const ELECTRIC_BLUE = '#0066ff'
export const NEON_CYAN = '#00ffff'
export const WHITE = '#ffffff'
export const MUTED = '#a0a4ab'
export const SCREEN = '#0c0e11'

// One color per sensor slot (server.py assigns slots). base: trace and waterfall;
// bright: the primary trace while its panel shows a detection. Slot 0, the
// default sensor, keeps the theme's blue and cyan.
export const NODE_COLORS = [
  { base: '#0066ff', bright: '#00ffff' },
  { base: '#1fbf6a', bright: '#7dffb8' },
  { base: '#8a5cff', bright: '#d2b8ff' },
  { base: '#e0b400', bright: '#fff07a' },
]

export const MONO_FONT = '"DejaVu Sans Mono", Menlo, monospace'

// Plot margins shared by the spectrum and waterfall, so their frequency axes line up
export const PLOT_PAD = { left: 44, right: 10, top: 22, bottom: 26 }

/** Sizes a canvas for the screen's pixel density; returns its CSS width and height. */
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1
  const { width, height } = canvas.getBoundingClientRect()
  const w = Math.round(width * dpr)
  const h = Math.round(height * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  return { width, height, dpr }
}

export function withAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
