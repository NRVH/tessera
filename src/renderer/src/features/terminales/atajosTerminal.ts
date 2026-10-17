// =============================================================================
// Atajos de búsqueda y portapapeles de las terminales de shell y del agente, para el
// manejador de teclas de xterm (devolver false cancela la tecla hacia el pty; true la
// deja pasar). El modificador es uno por plataforma y exclusivo (`esModPrincipal`,
// util/atajos.ts): Ctrl en Windows, Cmd en Mac. Cada atajo devuelve null si no le toca.
// Decisiones: docs/decisiones/terminales/raton-y-portapapeles-de-la-terminal.md
// =============================================================================

import type { Terminal } from '@xterm/xterm'
import type { Plataforma } from '../../../../shared/plataforma'
import { esAlternarAgente, esModPrincipal } from '../../util/atajos.ts'

/** Lo que los atajos disparan sobre el pane. */
export interface AccionesAtajos {
  /** Sin él, Mod+F llega al pty: la terminal del agente deja buscar al propio CLI. */
  abrirBuscador?: () => void
  copiar: () => void
  pegar: () => void
}

type Resultado = boolean | null

function esTecla(e: KeyboardEvent, letra: string): boolean {
  return e.key === letra || e.key === letra.toUpperCase()
}

/** Mod+F abre el buscador y cancela la tecla al pty (Ctrl+F queda sin ^F en Windows; en Mac es Cmd+F). */
function atajoBuscar(e: KeyboardEvent, mod: boolean, acc: AccionesAtajos): Resultado {
  if (!acc.abrirBuscador || !(mod && !e.shiftKey && !e.altKey && esTecla(e, 'f'))) return null
  e.preventDefault()
  acc.abrirBuscador()
  return false
}

/**
 * Mod+C híbrido: con selección copia y cancela (no manda ^C); sin ella deja pasar, que
 * es el ^C tradicional en Windows y nada en Mac.
 */
function atajoCopiarHibrido(
  e: KeyboardEvent,
  mod: boolean,
  term: Pick<Terminal, 'hasSelection' | 'clearSelection'>,
  acc: AccionesAtajos
): Resultado {
  if (!(mod && !e.shiftKey && !e.altKey && esTecla(e, 'c'))) return null
  if (!term.hasSelection()) return true
  e.preventDefault()
  acc.copiar()
  term.clearSelection()
  return false
}

/** Mod+Shift+C: variante explícita de copiar. */
function atajoCopiarExplicito(e: KeyboardEvent, mod: boolean, acc: AccionesAtajos): Resultado {
  if (!(mod && e.shiftKey && esTecla(e, 'c'))) return null
  e.preventDefault()
  acc.copiar()
  return false
}

/**
 * Mod+V no lo procesa xterm y NO se previene, para que el navegador emita el evento
 * `paste` con su clipboardData completo. Mod+Shift+V no tiene `paste` nativo: pega por IPC.
 */
function atajoPegar(e: KeyboardEvent, mod: boolean, acc: AccionesAtajos): Resultado {
  if (!(mod && esTecla(e, 'v'))) return null
  if (e.shiftKey) {
    e.preventDefault()
    acc.pegar()
  }
  return false
}

/** Manejador de teclas para `term.attachCustomKeyEventHandler`. */
export function crearManejadorAtajos(
  term: Pick<Terminal, 'hasSelection' | 'clearSelection'>,
  acc: AccionesAtajos,
  plataforma?: Plataforma
): (e: KeyboardEvent) => boolean {
  return (e) => {
    if (e.type !== 'keydown') return true
    // El acorde del agente lo atiende el oyente de la ventana. Fuera de Windows y macOS xterm
    // lo tomaría por Alt+Ctrl+B, mandaría ESC ^B al pty y CANCELARÍA el evento antes de que
    // llegue; devolver false lo deja subir sin tocarlo.
    if (esAlternarAgente(e, plataforma)) return false
    const mod = esModPrincipal(e, plataforma)
    return (
      atajoBuscar(e, mod, acc) ??
      atajoCopiarHibrido(e, mod, term, acc) ??
      atajoCopiarExplicito(e, mod, acc) ??
      atajoPegar(e, mod, acc) ??
      true
    )
  }
}
