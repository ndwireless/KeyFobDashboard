import { useEffect, useRef, useState } from 'react'
import Antenna from './Antenna.jsx'
import Dial from './Dial.jsx'
import NodeSelector from './NodeSelector.jsx'
import Spectrum from './Spectrum.jsx'
import VentSlots from './VentSlots.jsx'
import Waterfall from './Waterfall.jsx'
import { spectrumKey, useScanner } from './useScanner'

const DETECTION_GLOW_S = 2 // how long a panel stays lit after a detection

export default function App() {
  const scanner = useScanner()
  const { config, nodes, nodeOrder, shown, connected } = scanner

  // Re-render a few times a second so "Last seen" and the glow time out
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 250)
    return () => clearInterval(timer)
  }, [])

  return (
    <main>
      <header className="page-header">
        <img src="/resources/generalWhite-clear.png" alt="RadioHound" className="logo" />
        <div>
          <h1>RF Periodogram Telemetry Showcase</h1>
          <p className="subtitle">Real-time frequency spectrum analysis per wireless protocol.</p>
        </div>
      </header>
      {!connected && <p className="status">Connecting to server...</p>}
      {config && (
        <>
          <NodeSelector
            nodes={nodes}
            nodeOrder={nodeOrder}
            shown={shown}
            defaultNode={config.default_node}
            maxShown={config.max_shown_nodes}
            addState={scanner.addState}
            onShow={scanner.showNode}
            onHide={scanner.hideNode}
            onAdd={scanner.addNode}
            onRemove={scanner.removeNode}
          />
          {shown.length === 0 && <p className="status">Select a sensor above to start scanning.</p>}
          {/* Rows keep the order sensors were added in, so they don't jump around */}
          {nodeOrder.filter((mac) => shown.includes(mac) && nodes[mac]).map((mac) => (
            <section key={mac} className="node-row">
              {nodes[mac].error ? (
                <p className="status error">{nodes[mac].error}</p>
              ) : (
                <p className="status live">Live from sensor {mac}</p>
              )}
              <div className="panels">
                {config.bands.map((band) => (
                  <Panel
                    key={band.key}
                    band={band}
                    spectrumKey={spectrumKey(mac, band.key)}
                    info={nodes[mac].bands[band.key]}
                    now={now}
                    spectra={scanner.spectra}
                    yRange={config.y_range_dBm}
                    thresholdRange={config.threshold_range_dBm}
                    onThresholdChange={(value) => scanner.setThreshold(mac, band.key, value)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  )
}

function Panel({ band, spectrumKey, info, now, spectra, yRange, thresholdRange, onThresholdChange }) {
  const last = info?.lastDetected
  const active = last != null && now - last < DETECTION_GLOW_S

  // One antenna pulse per new detection (not for counts already there on page load)
  const count = info?.count ?? 0
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
          value={info.threshold}
          level={info?.level}
          range={thresholdRange}
          onChange={onThresholdChange}
        />
      </div>
      <div className="screen">
        <Spectrum band={band} spectrumKey={spectrumKey} spectra={spectra} yRange={yRange} active={active} />
        <Waterfall band={band} spectrumKey={spectrumKey} spectra={spectra} />
      </div>
      <VentSlots />
    </section>
  )
}

function formatAgo(seconds) {
  return seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`
}
