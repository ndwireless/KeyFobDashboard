import { useEffect, useRef, useState } from 'react'
import Antenna from './Antenna.jsx'
import Dial from './Dial.jsx'
import NodeSelector from './NodeSelector.jsx'
import Spectrum from './Spectrum.jsx'
import VentSlots from './VentSlots.jsx'
import Waterfall from './Waterfall.jsx'
import { NODE_COLORS } from './theme'
import { spectrumKey, useScanner } from './useScanner'

const DETECTION_GLOW_S = 2 // how long a panel stays lit after a detection

export default function App() {
  const scanner = useScanner()
  const { config, nodes, nodeOrder, bands, primary, connected } = scanner

  // Re-render a few times a second so "Last seen" and the glow time out
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 250)
    return () => clearInterval(timer)
  }, [])

  const primaryNode = nodes[primary]
  const offline = nodeOrder.filter((mac) => nodes[mac]?.error)
  let status
  if (!connected) status = <p className="status">Connecting to server...</p>
  else if (offline.length > 0) {
    status = offline.map((mac) => <p key={mac} className="status error">{nodes[mac].error}</p>)
  } else {
    const n = nodeOrder.length
    status = <p className="status live">Live from {n === 1 ? `sensor ${nodeOrder[0]}` : `${n} sensors`}</p>
  }

  return (
    <main>
      <header className="page-header">
        <img src="/resources/generalWhite-clear.png" alt="RadioHound" className="logo" />
        <div>
          <h1>RF KeyFob Frequency Detector</h1>
          <p className="subtitle">Real-time frequency spectrum analysis per wireless protocol.</p>
        </div>
      </header>
      {config && (
        <NodeSelector
          nodes={nodes}
          nodeOrder={nodeOrder}
          primary={primary}
          defaultNode={config.default_node}
          maxNodes={config.max_nodes}
          addState={scanner.addState}
          onSelect={scanner.setPrimary}
          onAdd={scanner.addNode}
          onRemove={scanner.removeNode}
        />
      )}
      {status}
      {config && primaryNode && (
        <div className="panels">
          {config.bands.map((band) => (
            <Panel
              key={band.key}
              band={band}
              // Every sensor's trace, primary last so it's drawn on top
              traces={[...nodeOrder.filter((mac) => mac !== primary), primary]
                .filter((mac) => nodes[mac])
                .map((mac) => ({ key: spectrumKey(mac, band.key), color: NODE_COLORS[nodes[mac].color] }))}
              waterfallKey={spectrumKey(primary, band.key)}
              waterfallColor={NODE_COLORS[primaryNode.color]}
              shared={bands[band.key]}
              primaryBand={primaryNode.bands[band.key]}
              now={now}
              spectra={scanner.spectra}
              yRange={config.y_range_dBm}
              thresholdRange={config.threshold_range_dBm}
              onThresholdChange={(value) => scanner.setThreshold(primary, band.key, value)}
            />
          ))}
        </div>
      )}
    </main>
  )
}

/**
 * One radio. shared: count and last detection from any sensor (drives the
 * glow, badge and antenna). primaryBand: the primary sensor's level and
 * threshold (drives the knob).
 */
function Panel({ band, traces, waterfallKey, waterfallColor, shared, primaryBand, now, spectra, yRange, thresholdRange, onThresholdChange }) {
  const last = shared?.lastDetected
  const active = last != null && now - last < DETECTION_GLOW_S

  // One antenna pulse per new detection (not for counts already there on page load)
  const count = shared?.count ?? 0
  const [pulseKey, setPulseKey] = useState(0)
  const previousCount = useRef(count)
  useEffect(() => {
    if (count > previousCount.current) setPulseKey((k) => k + 1)
    previousCount.current = count
  }, [count])

  let badge
  if (active) badge = <span className="badge hot">Signal detected</span>
  else if (last != null) badge = <span className="badge">Last seen {formatAgo(now - last)} ago</span>
  else badge = <span className="badge">Listening</span>

  return (
    <section className={active ? 'panel hot' : 'panel'}>
      <Antenna active={active} pulseKey={pulseKey} />
      <div className="panel-head">
        <h2>{band.title}</h2>
        {badge}
      </div>
      <div className="count-row">
        <span className="count">{count}</span>
        <span className="count-label">Times Detected</span>
        <Dial
          label={`${band.title} detection threshold`}
          value={primaryBand.threshold}
          level={primaryBand.level}
          range={thresholdRange}
          onChange={onThresholdChange}
        />
      </div>
      <div className="screen">
        <Spectrum band={band} traces={traces} spectra={spectra} yRange={yRange} active={active} />
        <Waterfall band={band} spectrumKey={waterfallKey} color={waterfallColor} spectra={spectra} />
      </div>
      <VentSlots />
    </section>
  )
}

function formatAgo(seconds) {
  return seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`
}
