// =============================================================================
// DbArea: el CENTRO de la vista de bases de datos. Tira de pestañas arriba (solo si
// hay alguna), debajo los panes de datos, fuente, consola, colección y clave de TODOS
// los perfiles en keep-alive (solo se ve el de la pestaña activa del perfil que se
// mira), y el estado vacío. El estado de la vista es de `useBdApp` (`useDbVista`):
// aquí solo se pinta y se pide cambiarlo.
// Decisiones: docs/decisiones/bd/ui-area-pestanas-y-panes.md
// =============================================================================

import { type CSSProperties } from 'react'
import './area.css'
import type { DbConnection } from '../../../../shared/db-ipc'
import type { DbConsolaInfo, DbTxModo } from '../../../../shared/db-explorador-ipc'
import type { DbVistaApi } from './useDbVista'
import { PromptDialog } from '../../comun/PromptDialog'
import { DbTabs } from './DbTabs'
import { paneDeArea, vacioDeArea } from './DbAreaPanes'
import { useAreaPorPane } from './useAreaPorPane'
import { useAreaTira } from './useAreaTira'
import { useAreaCierre } from './useAreaCierre'
import { useAreaRenombrar } from './useAreaRenombrar'

export interface DbAreaProps {
  /** Oculta entera (fuera de la vista 'db' o en el mosaico); nunca se desmonta por eso. */
  oculta: boolean
  /** Perfil cuya vista se enseña, o null sin perfil. */
  perfilId: string | null
  vista: DbVistaApi
  conexionesPorPerfil: ReadonlyMap<string, readonly DbConnection[]>
  /** El registro aún no respondió para el perfil que se ve. */
  cargandoConexiones: boolean
  /**
   * ¿El perfil que se ve tiene conexiones AJENAS (que esta versión no sabe abrir)? Con
   * solo esas, «Sin conexiones · Crea la primera» contradiría al árbol, que las enseña.
   * Basta un sí o un no: la pista no dice de qué causa es cada una (ver
   * `PISTA_SOLO_AJENAS`), eso lo dice su fila.
   */
  hayAjenas?: boolean
  /**
   * El aviso del main si el registro ENTERO del perfil que se ve tiene un formato que esta
   * versión no reconoce (`DbListaConexiones.aviso`), o null. Entonces el vacío no dice
   * «Sin conexiones» (sería falso: el archivo las tiene, pero no se entiende) ni ofrece
   * crear una, que el main rechazaría; enseña el aviso (`vacioAreaSinConexiones`).
   */
  avisoFormato?: string | null
  consolasPorPerfil: ReadonlyMap<string, readonly DbConsolaInfo[]>
  altoFila: number
  varsDensidad: CSSProperties
  /** Alto (global, persistido) del bloque de resultados de las consolas. */
  altoResultados: number
  onAltoResultados: (px: number) => void
  /** Filas por página de tablas y consolas (Configuración › «Bases de datos»). */
  filasPorPagina: number
  /** «Transacción al abrir» de Configuración, para las consolas (ver `DbConsolaPaneProps`). */
  txInicial: DbTxModo
  /** Acción del estado vacío "Sin conexiones": abre el diálogo de alta. */
  onNuevaConexion: () => void
  /** Crea una consola en esa conexión (con texto inicial opcional) y la abre. */
  onAbrirConsola: (perfilId: string, conexionId: string, textoInicial?: string) => void
  /** Abre el diálogo de edición de una conexión (el candado de la consola). */
  onEditarConexion: (conexionId: string) => void
  /** Algo cambió en las consolas de ese perfil (cerrar una vacía, renombrar). */
  onConsolasCambiaron: (perfilId: string) => void
}

export function DbArea(props: DbAreaProps): React.JSX.Element {
  const { oculta, perfilId, vista, conexionesPorPerfil, consolasPorPerfil, onConsolasCambiaron } = props
  const montadas = vista.todas
  const porPane = useAreaPorPane(montadas, conexionesPorPerfil, consolasPorPerfil)

  // --- La vista del perfil que se ve -------------------------------------------------
  const vistaActual = vista.vistaDe(perfilId)
  const tabs = vistaActual.pestanas.tabs
  const activeId = vistaActual.pestanas.activeId
  const conexionesActuales = perfilId !== null ? (conexionesPorPerfil.get(perfilId) ?? null) : null
  const consolasActuales = perfilId !== null ? (consolasPorPerfil.get(perfilId) ?? null) : null
  const { motores, titulos, indicadoresTira } = useAreaTira(perfilId, tabs, conexionesActuales, consolasActuales, porPane.indicadores)

  const { cerrar, onKeyDown } = useAreaCierre(vista, perfilId, activeId, onConsolasCambiaron)
  const { renombrar, setRenombrar, pedirRenombrar, confirmarRenombrar } = useAreaRenombrar(perfilId, tabs, consolasActuales, onConsolasCambiaron)

  const contexto = { ...props, porPane }
  const panes = montadas.map((m) => paneDeArea(m, contexto))
  const { cargandoConexiones, hayAjenas = false, avisoFormato = null, onNuevaConexion } = props
  const vacio = vacioDeArea({ perfilId, tabs, cargandoConexiones, hayAjenas, avisoFormato, conexionesActuales, onNuevaConexion })

  return (
    <div className={`db-area${oculta ? ' hidden' : ''}`} style={props.varsDensidad} tabIndex={-1} onKeyDown={onKeyDown}>
      {perfilId !== null && tabs.length > 0 && (
        <DbTabs
          tabs={tabs}
          activeId={activeId}
          titulos={titulos}
          indicadores={indicadoresTira}
          motores={motores}
          onActivar={(id) => vista.activar(perfilId, id)}
          onCerrar={(ids) => void cerrar(perfilId, ids)}
          onMover={(id, antesDe) => vista.mover(perfilId, id, antesDe)}
          onMostrarEnArbol={(id) => {
            const tab = tabs.find((t) => t.id === id)
            if (tab) vista.revelar(perfilId, tab.pane)
          }}
          onRenombrarConsola={pedirRenombrar}
        />
      )}
      <div className="db-panes">
        {panes}
        {vacio}
      </div>
      {renombrar && (
        <PromptDialog
          title="Renombrar consola"
          label="Nombre de la consola"
          initialValue={renombrar.nombre}
          confirmLabel="Renombrar"
          error={renombrar.error}
          onConfirm={(v) => void confirmarRenombrar(v)}
          onCancel={() => setRenombrar(null)}
        />
      )}
    </div>
  )
}
