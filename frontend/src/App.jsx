import { useEffect, useRef, useState } from 'react'
import Antenna from './Antenna.jsx'
import Spectrum from './Spectrum.jsx'
import Waterfall from './Waterfall.jsx'
import { useScanner } from './useScanner'

const DETECTION_GLOW_S = 2 // how long a panel stays lit after a detection

export default function App() {
  const { config, bands, error, connected, spectra } = useScanner()

  // Re-render a few times a second so "Last seen" and the glow time out
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 250)
    return () => clearInterval(timer)
  }, [])

  let status
  if (!connected) status = <p className="status">Connecting to server...</p>
  else if (error) status = <p className="status error">{error}</p>
  else status = <p className="status live">Live from sensor {config?.node}</p>

  return (
    <main>
      <header className="page-header">
        <img src="/resources/generalWhite-clear.png" alt="RadioHound" className="logo" />
        <div>
          <h1>RF Periodogram Telemetry Showcase</h1>
          <p className="subtitle">Real-time frequency spectrum analysis per wireless protocol.</p>
        </div>
      </header>
      {status}
      {config && (
        <div className="panels">
          {config.bands.map((band) => (
            <Panel
              key={band.key}
              band={band}
              info={bands[band.key]}
              now={now}
              spectra={spectra}
              yRange={config.y_range_dBm}
            />
          ))}
        </div>
      )}
    </main>
  )
}

function Panel({ band, info, now, spectra, yRange }) {
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
      </div>
      <div className="screen">
        <Spectrum band={band} spectra={spectra} yRange={yRange} active={active} />
        <Waterfall band={band} spectra={spectra} />
      </div>
    </section>
  )
}

function formatAgo(seconds) {
  return seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`
}
