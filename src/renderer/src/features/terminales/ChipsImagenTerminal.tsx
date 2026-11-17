// =============================================================================
// Miniaturas de las imágenes recién pegadas en una terminal: confirman qué se adjuntó
// cuando el CLI solo muestra una referencia de texto. Cada chip se autodescarta a los
// 7 s o al pulsar la ✕. Lo comparten la terminal de shell y la del agente.
// =============================================================================

import { useListaConSalida } from '../../comun/presencia'
import { useEffect, useRef } from 'react'
import { txTerminales } from './textos.ts'
import { IconoCerrar } from '../../comun/iconosMenu'

/** Miniatura de una imagen pegada, identificada para poder descartarla. */
export interface PreviaImagenPegada {
  id: number
  /** data URL (PNG reducido) de la miniatura. */
  url: string
}

interface PropsChipsImagenTerminal {
  elementos: PreviaImagenPegada[]
  onDescartar: (id: number) => void
}

/** Fila de miniaturas de imágenes pegadas; no pinta nada si no hay ninguna. */
export function ChipsImagenTerminal({ elementos, onDescartar }: PropsChipsImagenTerminal): React.JSX.Element | null {
  const lista = useListaConSalida(elementos, claveMiniatura)
  if (!lista.length) return null
  return (
    <div className="terminal-image-chips">
      {lista.map(({ elemento, saliendo }) => (
        <ChipImagenTerminal key={elemento.id} saliendo={saliendo} url={elemento.url} onDescartar={() => onDescartar(elemento.id)} />
      ))}
    </div>
  )
}

/** Duración antes de autodescartar una miniatura pegada. */
const CHIP_TTL_MS = 7000

const claveMiniatura = (elemento: PreviaImagenPegada): string => String(elemento.id)

function ChipImagenTerminal({ url, onDescartar, saliendo }: { url: string; onDescartar: () => void; saliendo: boolean }): React.JSX.Element {
  // onDescartar se recrea en cada render del padre; en un ref para que el temporizador
  // (montado una sola vez) no se reinicie ni capture una versión obsoleta.
  const descartarRef = useRef(onDescartar)
  descartarRef.current = onDescartar
  useEffect(() => {
    const t = setTimeout(() => descartarRef.current(), CHIP_TTL_MS)
    return () => clearTimeout(t)
  }, [])
  const t = txTerminales()

  return (
    <div className="terminal-image-chip mov-aparece" data-saliendo={saliendo ? '' : undefined}>
      <img src={url} alt={t.imagenPegada} draggable={false} />
      <button
        type="button"
        className="terminal-image-chip-close"
        onClick={() => descartarRef.current()}
        title={t.descartar}
        aria-label={t.descartarMiniatura}
      >
        <IconoCerrar />
      </button>
    </div>
  )
}
