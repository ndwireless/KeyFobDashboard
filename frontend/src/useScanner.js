import { useEffect, useRef, useState } from 'react'

const PEAK_HOLD_DECAY_dB_PER_S = 15 // how fast the dashed peak trace falls back to the live one
const AFTERGLOW_S = 3 // how long old traces linger on the spectrum screen

/**
 * Connects to server.py's /ws and keeps the dashboard's data.
 *
 * Counts, levels, thresholds and status live in React state (they change the
 * text and dials on the page).
 * Spectrum data lives in `spectra`, a ref, so canvases can redraw on every
 * capture without re-rendering React:
 *   spectra.current.get(bandKey) = {
 *     segments: Map(segmentKey -> {f_start, f_stop, power, hold, time}),
 *     afterglow: [{f_start, f_stop, power, time}],  // recent traces, newest last
 *     version,  // bumped on every capture
 *   }
 */
export function useScanner() {
  const spectra = useRef(new Map())
  const [config, setConfig] = useState(null)
  const [bands, setBands] = useState({}) // bandKey -> {count, lastDetected, level}
  const [thresholds, setThresholds] = useState({}) // bandKey -> dBm
  const [error, setError] = useState(null)
  const [connected, setConnected] = useState(false)
  const socket = useRef(null)

  useEffect(() => {
    let ws
    let retryTimer
    let closedByUs = false

    function addCapture(capture) {
      const spectrum = spectra.current.get(capture.band)
      if (!spectrum) return
      const power = Float32Array.from(capture.power)
      const hold = Float32Array.from(power)
      const previous = spectrum.segments.get(capture.segment)
      if (previous && previous.hold.length === power.length) {
        const decay = PEAK_HOLD_DECAY_dB_PER_S * (capture.time - previous.time)
        for (let i = 0; i < hold.length; i++) hold[i] = Math.max(power[i], previous.hold[i] - decay)
      }
      const trace = { f_start: capture.f_start, f_stop: capture.f_stop, power, time: capture.time }
      spectrum.segments.set(capture.segment, { ...trace, hold })
      spectrum.afterglow = spectrum.afterglow.filter((t) => capture.time - t.time < AFTERGLOW_S)
      spectrum.afterglow.push(trace)
      spectrum.version++
    }

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${protocol}://${location.host}/ws`)
      socket.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === 'init') {
          spectra.current = new Map(
            message.bands.map((b) => [b.key, { segments: new Map(), afterglow: [], version: 0 }]),
          )
          const counts = {}
          const bandThresholds = {}
          for (const band of message.bands) {
            const bandState = message.state[band.key]
            counts[band.key] = { count: bandState.count, lastDetected: bandState.last_detected, level: null }
            bandThresholds[band.key] = bandState.threshold
            bandState.segments.forEach(addCapture)
          }
          setConfig(message)
          setBands(counts)
          setThresholds(bandThresholds)
          setError(message.error)
        } else if (message.type === 'capture') {
          addCapture(message)
          setBands((prev) => ({
            ...prev,
            [message.band]: {
              count: message.count,
              lastDetected: message.last_detected,
              // BLE captures without an advertising channel have no level; keep the last one
              level: message.level ?? prev[message.band]?.level ?? null,
            },
          }))
        } else if (message.type === 'threshold') {
          setThresholds((prev) => ({ ...prev, [message.band]: message.value }))
        } else if (message.type === 'status') {
          setError(message.error)
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closedByUs) retryTimer = setTimeout(connect, 1000)
      }
    }

    connect()
    return () => {
      closedByUs = true
      clearTimeout(retryTimer)
      ws.close()
    }
  }, [])

  /** Sets a band's detection threshold here and on the server (shared by all tabs). */
  function setThreshold(bandKey, value) {
    setThresholds((prev) => ({ ...prev, [bandKey]: value }))
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: 'threshold', band: bandKey, value }))
    }
  }

  return { config, bands, thresholds, setThreshold, error, connected, spectra }
}

export { AFTERGLOW_S }
