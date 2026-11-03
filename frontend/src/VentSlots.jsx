// Easter egg: the vent slots spell this in Morse code (short slot = dot, long = dash)
const MESSAGE = 'JORDAN'
const MORSE = { A: '.-', D: '-..', J: '.---', N: '-.', O: '---', R: '.-.' }

/** Row of ventilation slots along the bottom of a receiver panel. */
export default function VentSlots() {
  return (
    <div className="vents" aria-hidden="true">
      {[...MESSAGE].map((letter, i) => (
        <span key={i} className="vent-letter">
          {[...MORSE[letter]].map((symbol, j) => (
            <span key={j} className={symbol === '.' ? 'vent dot' : 'vent dash'} />
          ))}
        </span>
      ))}
    </div>
  )
}
