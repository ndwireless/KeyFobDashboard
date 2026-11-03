import { useEffect, useState } from 'react'

const MESSAGE = 'JORDAN'
const UNIT_MS = 150
const LIGHT_COUNT = 5
const MORSE = { A: '.-', D: '-..', J: '.---', N: '-.', O: '---', R: '.-.' }

// [on, units] steps: dot 1, dash 3, 1 between symbols, 3 between letters, 7 before repeating
const STEPS = [...MESSAGE].flatMap((letter, i) => {
  const symbols = [...MORSE[letter]]
  return symbols.flatMap((symbol, j) => [
    [true, symbol === '.' ? 1 : 3],
    [false, j < symbols.length - 1 ? 1 : i < MESSAGE.length - 1 ? 3 : 7],
  ])
})

/** A row of red indicator lights blinking MESSAGE in Morse code, in unison. */
export default function MorseLights() {
  const [lit, setLit] = useState(false)

  useEffect(() => {
    let step = 0
    let timer
    function next() {
      const [on, units] = STEPS[step]
      setLit(on)
      step = (step + 1) % STEPS.length
      timer = setTimeout(next, units * UNIT_MS)
    }
    next()
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className={lit ? 'morse lit' : 'morse'} aria-hidden="true">
      {Array.from({ length: LIGHT_COUNT }, (_, i) => <span key={i} className="morse-light" />)}
    </div>
  )
}
