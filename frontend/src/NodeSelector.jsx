import { useEffect, useState } from 'react'
import { NODE_COLORS } from './theme'

/**
 * Bar of sensors, each in its trace color: click one to make it the primary
 * (bright trace, waterfall, knobs), add a node by MAC address, or remove an
 * added one.
 */
export default function NodeSelector({ nodes, nodeOrder, primary, defaultNode, maxNodes, addState, onSelect, onAdd, onRemove }) {
  const [mac, setMac] = useState('')
  const full = nodeOrder.length >= maxNodes

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
    if (!mac.trim() || addState.pending || full) return
    onAdd(mac.trim())
    setSubmitted(true)
  }

  return (
    <div className="node-bar">
      <div className="node-list">
        {nodeOrder.map((nodeMac) => {
          const node = nodes[nodeMac]
          if (!node) return null
          const isPrimary = nodeMac === primary
          return (
            <div
              key={nodeMac}
              className={isPrimary ? 'node-chip on' : 'node-chip'}
              style={{ '--node-color': NODE_COLORS[node.color].base }}
            >
              <button type="button" className="node-toggle" aria-pressed={isPrimary} onClick={() => onSelect(nodeMac)}>
                <span className={node.error ? 'node-dot error' : 'node-dot'} />
                {nodeMac}
                {isPrimary && <span className="node-tag">Waterfall</span>}
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
            disabled={full}
          />
          <button type="submit" disabled={addState.pending || !mac.trim() || full}>
            {addState.pending ? 'Checking...' : 'Add sensor'}
          </button>
        </form>
      </div>
      {addState.error ? (
        <p className="node-hint error">{addState.error}</p>
      ) : (
        <p className="node-hint">
          Click a sensor to show it on the waterfall. Up to {maxNodes} sensors, cleared when the server restarts.
        </p>
      )}
    </div>
  )
}
