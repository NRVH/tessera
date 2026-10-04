// =============================================================================
// Variables CSS inline de `.shell`: el color del perfil activo (del que cuelga todo
// lo «seleccionado»), su tinta legible para letra y resaltados, y los tamaños de
// las zonas redimensionables, que la cascada lleva a cada panel.
// =============================================================================
import type React from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { SalidaLayoutCentro } from './layoutCentro'
import { useStoreLayout } from './store'
import type { Tamanos } from './useTamanos'

/** Entrada del estilo de `.shell`. */
export interface EntradaEstiloShell {
  tintaPerfilActivo: string | null
  resaltadoPerfil: string | null
  sidebarWidth: number
  /** Ancho de la columna del agente que toca: el del agente de datos con su divisor, o el de siempre. */
  ccWidth: number
  altoPanelInferior: number
  gitLogRamasWidth: number
  gitLogDetalleWidth: number
}

/** Estilo de `.shell` con los tamaños del store y la columna del agente que toca. */
export function useEstiloShell(
  tintas: Pick<EntradaEstiloShell, 'tintaPerfilActivo' | 'resaltadoPerfil'>,
  tamanos: Pick<Tamanos, 'sidebarWidth' | 'dbAgenteWidthVisible'>,
  divisorAgente: SalidaLayoutCentro['divisorAgente']
): React.CSSProperties {
  const l = useStoreLayout(
    useShallow((s) => ({
      ccWidth: s.ccWidth,
      altoPanelInferior: s.altoPanelInferior,
      gitLogRamasWidth: s.gitLogRamasWidth,
      gitLogDetalleWidth: s.gitLogDetalleWidth
    }))
  )
  return estiloShell({
    ...tintas,
    ...l,
    sidebarWidth: tamanos.sidebarWidth,
    // Una sola variable para la columna del agente: con el divisor de BD, el ancho del agente de datos.
    ccWidth: divisorAgente === 'db' ? tamanos.dbAgenteWidthVisible : l.ccWidth
  })
}

/** Variables CSS de `.shell`; sin perfil se omiten y heredan las de `:root`. */
export function estiloShell(e: EntradaEstiloShell): React.CSSProperties {
  return {
    // Tinta y no el color crudo: un verde puro de fondo competiría con el código.
    ...(e.tintaPerfilActivo ? { '--perfil': e.tintaPerfilActivo } : {}),
    // Fondo y letra del resaltado van juntos: la letra casi negra solo es legible sobre la tinta clara.
    ...(e.resaltadoPerfil
      ? {
          '--perfil-claro': e.resaltadoPerfil,
          '--perfil-sobre-tinte': 'var(--perfil-claro)',
          '--perfil-hit': 'var(--perfil-claro)',
          '--perfil-hit-fg': 'var(--search-hit-fg)',
          // Aquí y no en el CSS: sin perfil, confirmar un borrado tiene que seguir en rojo.
          '--confirmar-color': 'var(--perfil-claro)',
          '--confirmar-color-fuerte': 'var(--perfil-claro)'
        }
      : {}),
    '--sidebar-width': `${e.sidebarWidth}px`,
    '--cc-width': `${e.ccWidth}px`,
    '--panel-inferior-h': `${e.altoPanelInferior}px`,
    '--git-log-ramas-w': `${e.gitLogRamasWidth}px`,
    '--git-log-detalle-w': `${e.gitLogDetalleWidth}px`
  } as React.CSSProperties
}
