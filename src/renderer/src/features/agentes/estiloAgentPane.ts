// =============================================================================
// Clase y estilo en línea del nodo raíz del pane del agente. La posición en la rejilla
// y el color del perfil van SOBRE el propio pane y no en un envoltorio: envolverlo lo
// desmontaría, y desmontarlo cierra la sesión.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import type { CSSProperties } from 'react'
import type { CeldaMosaico } from '../mosaico'
import type { MosaicoPane } from './agentPaneTipos'

/** Clase del nodo raíz: oculto, casilla del mosaico y casilla enfocada. */
export function clasePane(mostrado: boolean, mosaico: MosaicoPane | null): string {
  return `agent-pane${mostrado ? '' : ' hidden'}${mosaico ? ' casilla-mosaico' : ''}${
    mosaico?.enfocada ? ' enfocada' : ''
  }`
}

/** Colores de la casilla: los de su perfil, o los de "sin perfil" si no tiene color. */
function coloresCasilla(mosaico: MosaicoPane): Record<string, string> {
  return {
    ['--perfil' as string]: mosaico.color ?? 'var(--azul)',
    ...(mosaico.colorClaro
      ? {
          ['--perfil-claro' as string]: mosaico.colorClaro,
          ['--perfil-sobre-tinte' as string]: 'var(--perfil-claro)',
          ['--confirmar-color' as string]: 'var(--perfil-claro)',
          ['--confirmar-color-fuerte' as string]: 'var(--perfil-claro)'
        }
      : {
          ['--perfil-claro' as string]: 'var(--azul)',
          ['--perfil-sobre-tinte' as string]: 'var(--fg)',
          ['--confirmar-color' as string]: 'var(--red)',
          ['--confirmar-color-fuerte' as string]: 'var(--red-hi)'
        })
  }
}

/**
 * Estilo en línea de una casilla: su celda en la rejilla y las mismas variables que
 * `.shell` publica para el perfil activo, pero con el de ESTA casilla. Fuera del
 * mosaico, ninguno.
 */
export function estiloCasilla(mosaico: MosaicoPane | null, celda: CeldaMosaico | null): CSSProperties | undefined {
  if (!mosaico) return undefined
  return {
    ...(celda
      ? {
          gridRow: `${celda.fila} / span ${celda.spanFilas}`,
          gridColumn: `${celda.columna} / span ${celda.spanColumnas}`
        }
      : {}),
    ...coloresCasilla(mosaico)
  } as CSSProperties
}
