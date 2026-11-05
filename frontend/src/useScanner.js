import { useEffect, useRef, useState } from 'react'

const PEAK_HOLD_DECAY_dB_PER_S = 15 // how fast the dashed peak trace falls back to the live one
const AFTERGLOW_S = 3 // how long old traces linger on the spectrum screen

/** Key into `spectra` for one node's band. */
export const spectrumKey = (mac, bandKey) => `${mac}|${bandKey}`

/**
 * Connects to server.py's /ws and keeps the dashboard's data.
 *
 * Nodes (counts, levels, thresholds, errors), which are shown, and status
 * live in React state (they change the text and dials on the page):
 *   nodes = {mac: {error, bands: {bandKey: {count, lastDetected, level, threshold}}}}
 *   nodeOrder = [mac, ...]  // order added
 *   shown = [mac, ...]      // on screen, oldest first
 * Spectrum data lives in `spectra`, a ref, so canvases can redraw on every
 * capture without re-rendering React:
 *   spectra.current.get(spectrumKey(mac, bandKey)) = {
 *     segments: Map(segmentKey -> {f_start, f_stop, power, hold, time}),
 *     afterglow: [{f_start, f_stop, power, time}],  // recent traces, newest last
 *     version,  // bumped on every capture
 *   }
 */
export function useScanner() {
  const spectra = useRef(new Map())
  const [config, setConfig] = useState(null)
  const [nodes, setNodes] = useState({})
  const [nodeOrder, setNodeOrder] = useState([])
  const [shown, setShown] = useState([])
  const [addState, setAddState] = useState({ pending: false, error: null })
  const [connected, setConnected] = useState(false)
  const socket = useRef(null)

  useEffect(() => {
    let ws
    let retryTimer
    let closedByUs = false

    function addCapture(capture) {
      const spectrum = spectra.current.get(spectrumKey(capture.node, capture.band))
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

    /** Sets up spectra for a node from the server's snapshot; returns its React state. */
    function loadNode(snapshot) {
      const bandStates = {}
      for (const [bandKey, b] of Object.entries(snapshot.bands)) {
        spectra.current.set(spectrumKey(snapshot.mac, bandKey), { segments: new Map(), afterglow: [], version: 0 })
        b.segments.forEach((segment) => addCapture({ ...segment, node: snapshot.mac }))
        bandStates[bandKey] = { count: b.count, lastDetected: b.last_detected, level: null, threshold: b.threshold }
      }
      return { error: snapshot.error, bands: bandStates }
    }

    function updateBand(mac, bandKey, update) {
      setNodes((prev) => {
        const node = prev[mac]
        if (!node) return prev
        return { ...prev, [mac]: { ...node, bands: { ...node.bands, [bandKey]: update(node.bands[bandKey]) } } }
      })
    }

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${protocol}://${location.host}/ws`)
      socket.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === 'init') {
          spectra.current = new Map()
          const loaded = {}
          for (const snapshot of message.nodes) loaded[snapshot.mac] = loadNode(snapshot)
          setConfig(message)
          setNodes(loaded)
          setNodeOrder(message.nodes.map((n) => n.mac))
          setShown(message.shown)
          setAddState({ pending: false, error: null })
        } else if (message.type === 'capture') {
          addCapture(message)
          updateBand(message.node, message.band, (b) => ({
            ...b,
            count: message.count,
            lastDetected: message.last_detected,
            // BLE captures without an advertising channel have no level; keep the last one
            level: message.level ?? b.level,
          }))
        } else if (message.type === 'threshold') {
          updateBand(message.node, message.band, (b) => ({ ...b, threshold: message.value }))
        } else if (message.type === 'status') {
          setNodes((prev) => (prev[message.node] ? { ...prev, [message.node]: { ...prev[message.node], error: message.error } } : prev))
        } else if (message.type === 'shown') {
          setShown(message.shown)
        } else if (message.type === 'node_added') {
          const node = loadNode(message.node)
          setNodes((prev) => ({ ...prev, [message.node.mac]: node }))
          setNodeOrder((prev) => (prev.includes(message.node.mac) ? prev : [...prev, message.node.mac]))
          setShown(message.shown)
          setAddState({ pending: false, error: null })
        } else if (message.type === 'add_failed') {
          setAddState({ pending: false, error: message.error })
        } else if (message.type === 'node_removed') {
          for (const key of spectra.current.keys()) {
            if (key.startsWith(`${message.node}|`)) spectra.current.delete(key)
          }
          setNodes((prev) => {
            const { [message.node]: _removed, ...rest } = prev
            return rest
          })
          setNodeOrder((prev) => prev.filter((mac) => mac !== message.node))
          setShown(message.shown)
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

  function send(message) {
    if (socket.current?.readyState !== WebSocket.OPEN) return false
    socket.current.send(JSON.stringify(message))
    return true
  }

  /** Sets a band's detection threshold here and on the server (shared by all tabs). */
  function setThreshold(mac, bandKey, value) {
    setNodes((prev) => {
      const node = prev[mac]
      if (!node) return prev
      return { ...prev, [mac]: { ...node, bands: { ...node.bands, [bandKey]: { ...node.bands[bandKey], threshold: value } } } }
    })
    send({ type: 'threshold', node: mac, band: bandKey, value })
  }

  function addNode(mac) {
    if (send({ type: 'add', mac })) setAddState({ pending: true, error: null })
  }

  return {
    config,
    nodes,
    nodeOrder,
    shown,
    connected,
    spectra,
    addState,
    setThreshold,
    addNode,
    showNode: (mac) => send({ type: 'show', node: mac }),
    hideNode: (mac) => send({ type: 'hide', node: mac }),
    removeNode: (mac) => send({ type: 'remove', node: mac }),
  }
}

export { AFTERGLOW_S }
