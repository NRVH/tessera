// =============================================================================
// Miniaturas de las imágenes recién pegadas en una terminal: confirman qué se adjuntó
// cuando el CLI solo muestra una referencia de texto. Cada chip se autodescarta a los
// 7 s o al pulsar la ✕. Lo comparten la terminal de shell y la del agente.
// =============================================================================

import { useEffect, useRef } from 'react'

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
  if (!items.length) return null
  return (
    <div className="terminal-image-chips">
      {items.map((it) => (
        <TerminalImageChip key={it.id} url={it.url} onDismiss={() => onDismiss(it.id)} />
      ))}
    </div>
  )
}

/** Duración antes de autodescartar una miniatura pegada. */
const CHIP_TTL_MS = 7000

function TerminalImageChip({ url, onDismiss }: { url: string; onDismiss: () => void }): React.JSX.Element {
  // onDismiss se recrea en cada render del padre; en un ref para que el temporizador
  // (montado una sola vez) no se reinicie ni capture una versión obsoleta.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), CHIP_TTL_MS)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="terminal-image-chip" title="Imagen pegada">
      <img src={url} alt="Imagen pegada" draggable={false} />
      <button
        type="button"
        className="terminal-image-chip-close"
        onClick={() => dismissRef.current()}
        title="Descartar"
        aria-label="Descartar miniatura"
      >
        ✕
      </button>
    </div>
  )
}
