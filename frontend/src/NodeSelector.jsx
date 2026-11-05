import { useEffect, useState } from 'react'

/**
 * Bar of sensor toggles: pick which nodes are on screen (and scanned), add a
 * node by MAC address, or remove an added one.
 */
export default function NodeSelector({ nodes, nodeOrder, shown, defaultNode, maxShown, addState, onShow, onHide, onAdd, onRemove }) {
  const [mac, setMac] = useState('')

  // Clear the field once the server has added the node
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => {
    if (submitted && !addState.pending) {
      if (!addState.error) setMac('')
      setSubmitted(false)
    }
  }, [submitted, addState])

  function submit(event) {
    event.preventDefault()
    if (!mac.trim() || addState.pending) return
    onAdd(mac.trim())
    setSubmitted(true)
  }

  return (
    <div className="node-bar">
      <div className="node-list">
        {nodeOrder.map((nodeMac) => {
          const on = shown.includes(nodeMac)
          let dot = 'node-dot'
          if (on) dot += nodes[nodeMac]?.error ? ' error' : ' live'
          return (
            <div key={nodeMac} className={on ? 'node-chip on' : 'node-chip'}>
              <button
                type="button"
                className="node-toggle"
                aria-pressed={on}
                onClick={() => (on ? onHide(nodeMac) : onShow(nodeMac))}
              >
                <span className={dot} />
                {nodeMac}
              </button>
              {nodeMac !== defaultNode && (
                <button type="button" className="node-remove" aria-label={`Remove sensor ${nodeMac}`} onClick={() => onRemove(nodeMac)}>
                  ×
                </button>
              )}
            </div>
          )
        })}
        <form className="node-add" onSubmit={submit}>
          <input
            value={mac}
            onChange={(event) => setMac(event.target.value)}
            placeholder="MAC address"
            aria-label="Sensor MAC address"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" disabled={addState.pending || !mac.trim()}>
            {addState.pending ? 'Checking...' : 'Add sensor'}
          </button>
        </form>
      </div>
      {addState.error ? (
        <p className="node-hint error">{addState.error}</p>
      ) : (
        <p className="node-hint">
          Up to {maxShown} sensors on screen. Only sensors on screen are scanned, and added sensors are cleared when the server restarts.
        </p>
      )}
    </div>
  )
}
