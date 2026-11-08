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
export interface PastedImagePreview {
  id: number
  /** data URL (PNG reducido) de la miniatura. */
  url: string
}

interface TerminalImageChipsProps {
  items: PastedImagePreview[]
  onDismiss: (id: number) => void
}

/** Fila de miniaturas de imágenes pegadas; no pinta nada si no hay ninguna. */
export function TerminalImageChips({ items, onDismiss }: TerminalImageChipsProps): React.JSX.Element | null {
  const lista = useListaConSalida(items, claveMiniatura)
  if (!lista.length) return null
  return (
    <div className="terminal-image-chips">
      {lista.map(({ item: it, saliendo }) => (
        <TerminalImageChip key={it.id} saliendo={saliendo} url={it.url} onDismiss={() => onDismiss(it.id)} />
      ))}
    </div>
  )
}

/** Duración antes de autodescartar una miniatura pegada. */
const CHIP_TTL_MS = 7000

const claveMiniatura = (item: PastedImagePreview): string => String(item.id)

function TerminalImageChip({ url, onDismiss, saliendo }: { url: string; onDismiss: () => void; saliendo: boolean }): React.JSX.Element {
  // onDismiss se recrea en cada render del padre; en un ref para que el temporizador
  // (montado una sola vez) no se reinicie ni capture una versión obsoleta.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), CHIP_TTL_MS)
    return () => clearTimeout(t)
  }, [])
  const t = txTerminales()

  return (
    <div className="terminal-image-chip mov-aparece" data-saliendo={saliendo ? '' : undefined}>
      <img src={url} alt={t.imagenPegada} draggable={false} />
      <button
        type="button"
        className="terminal-image-chip-close"
        onClick={() => dismissRef.current()}
        title={t.descartar}
        aria-label={t.descartarMiniatura}
      >
        <IconoCerrar />
      </button>
    </div>
  )
}
