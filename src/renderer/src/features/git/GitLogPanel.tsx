// =============================================================================
// GitLogPanel: la ventana «Git · Log» de la franja inferior, en tres columnas: ramas,
// filtros con grafo y commits, y archivos con el detalle del commit. Aquí vive toda la
// historia; el sidebar se queda con el working tree. Se monta bajo demanda: las cachés
// de módulo de `modelo/cacheGit` hacen que reabrir sea instantáneo.
// El estado y los efectos están en `useEstadoLog`; este archivo solo compone y pinta.
// Decisiones: docs/decisiones/git/log-identidad-y-anclaje.md
// =============================================================================

import { useLayoutEffect } from 'react'
import { EstadoVacio, IconoCarpetaVacia } from '../../comun/EstadoVacio'
import { Splitter } from '../../comun/Splitter'
import { ArbolRamas } from './ArbolRamas'
import { DetalleCommit } from './DetalleCommit'
import { asegurarEstilosGit } from './estilosGit'
import { HistorialArchivo } from './HistorialArchivo'
import { IconoMaximizar, IconoRestaurar } from '../../comun/iconosPanel'
import { etiquetaAcorde } from '../../util/atajos'
import { IconoGitVacio, IconoRecargar } from './iconos'
import { ColumnaCentro } from './ListaCommits'
import { useEstadoLog, type EstadoLog } from './useEstadoLog'
import type { OrigenApertura } from './useSeleccionLog'
import type { DiffEditorPane, DiffTarget } from '../editor'
import type { DetectedRepo } from '../../../../shared/workspace-ipc'
import type { OpenProject } from '../pestanas'

export interface GitLogPanelProps {
  /** Alto de fila en px (theme/densidad; el mismo que ve el CSS). */
  altoFila: number
  /**
   * Variables CSS de densidad de ESTA superficie: se escriben en la raíz del panel, no en
   * `:root`. Salen del mismo número que `altoFila` o el scroll de las listas se descuadra.
   */
  varsDensidad?: React.CSSProperties
  /** Reparto vertical de la tercera columna: cuánto se lleva la lista de archivos. */
  altoArchivos: number
  minArchivos: number
  onAltoArchivos: (px: number) => void
  /** Proyecto y repo que se están MOSTRANDO (los del perfil activo); ver `anclado`. */
  activeProject: OpenProject | null
  activeRepo: DetectedRepo | null
  repos: DetectedRepo[] | null
  onSelectRepo: (repoHostPath: string) => void
  /**
   * ¿El backend está anclado a ESTE repo? Es el permiso para PEDIR, no para pintar: sin
   * anclaje el backend contesta vacío y ese vacío no se distingue de un repo nuevo.
   */
  anclado: boolean
  /**
   * Sube el diff armado al abrir un archivo de un commit; el colapso lo decide la franja, y
   * con el `origen` también qué se hace a pantalla completa (`aperturaDesdeGit`).
   */
  onOpenDiff: (target: DiffTarget, origen: OrigenApertura) => void
  /** Cierra la franja (botón × del header). */
  onClose: () => void
  /** El panel ocupa toda el área de trabajo; los botones de restaurar y de cerrar se quedan fijos. */
  pantallaCompleta: boolean
  onPantallaCompleta: (valor: boolean) => void
  /** Anchos de las columnas de ramas y de detalle (persistidos en ajustes). */
  anchoRamas: number
  onAnchoRamas: (px: number) => void
  anchoDetalle: number
  onAnchoDetalle: (px: number) => void
  /** Límites de los dos divisores, para que el panel no se quede sin centro. */
  colMin: number
  colMax: number
  /** Sube tras un commit y cuando el watcher ve tocar HEAD o refs: invalida el historial. */
  commitTick?: number
  /** Lo escrito en el buscador; vive en `useStoreGit`, por perfil. */
  consulta: string
  onConsulta: (q: string) => void
  /** Archivo cuyo HISTORIAL se mira, o null; vive en el store porque lo abre el explorador. */
  historial: string | null
  /** Sube en CADA petición de historial, aunque sea del mismo archivo. */
  historialToken: number
  /** Cierra la pestaña del historial y vuelve al log. */
  onCerrarHistorial: () => void
  /** Ancho de la lista del historial: solo de sesión, no se escribe en los ajustes. */
  anchoHistorial: number
  onAnchoHistorial: (px: number) => void
  /** Botones del visor de diff del historial: pasan de largo, este panel no los usa. */
  onSaltarAlFuente: (target: DiffTarget, linea: number) => void
  /** El visor de diff del editor, para el historial; ver `HistorialArchivoProps.VisorDiff`. */
  VisorDiff: typeof DiffEditorPane
  colapsarSinCambios: boolean
  onColapsarSinCambios: (valor: boolean) => void
}

function CabeceraLog(p: {
  nombreRepo: string
  cargando: boolean
  recargarDeshabilitado: boolean
  onRecargar: () => void
  pantallaCompleta: boolean
  onPantallaCompleta: (valor: boolean) => void
  onClose: () => void
}): React.JSX.Element {
  const etiquetaModo = p.pantallaCompleta ? 'Restaurar el panel de git' : 'Maximizar el panel de git'
  // `fijo`: a pantalla completa restaurar y cerrar son las dos salidas del modo y no se esconden en reposo.
  const fijo = p.pantallaCompleta ? ' fijo' : ''
  return (
    <header className="panel-header">
      <span className="panel-title">
        <span>Git</span>
        {p.nombreRepo !== '' && <span className="accent">{p.nombreRepo}</span>}
      </span>
      <div className="panel-actions">
        <button
          // `girando` impide que el fundido en reposo se lleve el único aviso de recarga.
          className={`git-icon-btn${p.cargando ? ' girando' : ''}`}
          onClick={p.onRecargar}
          disabled={p.recargarDeshabilitado}
          title="Recargar el historial y las ramas"
          aria-label="Recargar el historial y las ramas"
        >
          <IconoRecargar girando={p.cargando} />
        </button>
        <button
          className={`git-icon-btn${fijo}`}
          onClick={() => p.onPantallaCompleta(!p.pantallaCompleta)}
          title={`${
            p.pantallaCompleta
              ? 'Restaurar: git vuelve al panel inferior'
              : 'Maximizar: git ocupa toda el área de trabajo (sin cerrar nada)'
          } (${etiquetaAcorde('pantallaCompleta')})`}
          aria-label={etiquetaModo}
        >
          {p.pantallaCompleta ? <IconoRestaurar /> : <IconoMaximizar />}
        </button>
        <button
          className={`git-icon-btn${fijo}`}
          onClick={p.onClose}
          title="Cerrar el panel de git"
          aria-label="Cerrar el panel de git"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  )
}

/** Tira de pestañas Log / Historial; solo existe mientras hay un historial abierto. */
function PestanasVistas(p: {
  historial: string
  vistaHistorial: boolean
  setVistaHistorial: (valor: boolean) => void
  onCerrarHistorial: () => void
}): React.JSX.Element {
  const { historial, vistaHistorial, setVistaHistorial } = p
  return (
    <div className="git-vistas-tabs" role="tablist" aria-label="Vistas de git">
      <button
        className={`git-vista-tab${vistaHistorial ? '' : ' activa'}`}
        role="tab"
        aria-selected={!vistaHistorial}
        onClick={() => setVistaHistorial(false)}
      >
        Log
      </button>
      <button
        className={`git-vista-tab${vistaHistorial ? ' activa' : ''}`}
        role="tab"
        aria-selected={vistaHistorial}
        onClick={() => setVistaHistorial(true)}
        title={historial}
      >
        Historial: {historial.slice(historial.lastIndexOf('/') + 1)}
        <span
          className="git-vista-tab-cerrar"
          role="button"
          aria-label="Cerrar el historial"
          title="Cerrar el historial"
          onClick={(ev) => {
            ev.stopPropagation()
            p.onCerrarHistorial()
          }}
        >
          ×
        </span>
      </button>
    </div>
  )
}

/** Las tres columnas: ramas, centro y detalle del commit. */
function CuerpoLog({ props, e }: { props: GitLogPanelProps; e: EstadoLog }): React.JSX.Element {
  const { commitSeleccionado, copia } = e
  return (
    <div className="git-log-body">
      <ArbolRamas
        branches={e.datos.branches}
        ramaActiva={e.filtros.rama}
        repos={props.repos}
        repoLabels={e.repoLabels}
        repoActivo={e.id.repoHostPath}
        onSeleccionarRama={e.seleccionarRama}
        onSeleccionarRepo={props.onSelectRepo}
      />
      <Splitter
        orientation="vertical"
        size={props.anchoRamas}
        min={props.colMin}
        max={props.colMax}
        direction={1}
        onResize={props.onAnchoRamas}
        label="Ancho de la columna de ramas"
      />
      <ColumnaCentro
        e={e}
        altoFila={props.altoFila}
        consulta={props.consulta}
        onConsulta={props.onConsulta}
      />
      <Splitter
        orientation="vertical"
        size={props.anchoDetalle}
        min={props.colMin}
        max={props.colMax}
        // Arrastrar hacia la IZQUIERDA agranda la columna de detalle, que está a la derecha.
        direction={-1}
        onResize={props.onAnchoDetalle}
        label="Ancho de la columna de detalle"
      />
      <DetalleCommit
        commit={commitSeleccionado}
        repoHostPath={e.id.repoHostPath}
        anclado={props.anclado}
        altoFila={props.altoFila}
        altoArchivos={props.altoArchivos}
        minArchivos={props.minArchivos}
        onAltoArchivos={props.onAltoArchivos}
        rutaSeleccionada={e.sel.rutaSeleccionada}
        onSeleccionarArchivo={e.seleccionarArchivo}
        onAbrirDiff={e.apertura.abrirDiffManual}
        onFilasArchivos={e.apertura.recibirFilas}
        revelarArchivo={e.sel.revelarArchivo}
        onKeyDownArchivos={e.teclas.teclasArchivos}
        alternarCarpetaRef={e.sel.alternarCarpetaRef}
        copiado={commitSeleccionado !== null && commitSeleccionado.hash === copia.hashCopiado}
        onCopiarHash={() => {
          if (commitSeleccionado) copia.copiarHashDeCommit(commitSeleccionado.hash)
        }}
      />
    </div>
  )
}

/** Pestañas (si hay historial abierto) y la vista elegida: historial del archivo o log. */
function ContenidoLog({ props, e }: { props: GitLogPanelProps; e: EstadoLog }): React.JSX.Element {
  const { historial } = props
  const { vistaHistorial, setVistaHistorial } = e.historial
  return (
    <>
      {historial !== null && (
        <PestanasVistas
          historial={historial}
          vistaHistorial={vistaHistorial}
          setVistaHistorial={setVistaHistorial}
          onCerrarHistorial={props.onCerrarHistorial}
        />
      )}
      {vistaHistorial && historial !== null ? (
        <HistorialArchivo
          // Por ruta: cambiar de archivo tiene que empezar de cero, no reutilizar el anterior.
          key={historial}
          path={historial}
          altoFila={props.altoFila}
          anchoLista={props.anchoHistorial}
          onAnchoLista={props.onAnchoHistorial}
          colMin={props.colMin}
          colMax={props.colMax}
          onAbrirEnEditor={(target) => props.onOpenDiff(target, 'manual')}
          onSaltarAlFuente={props.onSaltarAlFuente}
          VisorDiff={props.VisorDiff}
          colapsarSinCambios={props.colapsarSinCambios}
          onColapsarSinCambios={props.onColapsarSinCambios}
        />
      ) : (
        <CuerpoLog props={props} e={e} />
      )}
    </>
  )
}

export function GitLogPanel(props: GitLogPanelProps): React.JSX.Element {
  useLayoutEffect(() => asegurarEstilosGit(), [])
  const e = useEstadoLog(props)
  const { projectHostPath, repoSeleccionado, repoHostPath } = e.id
  const nombreRepo =
    (repoHostPath && e.repoLabels.get(repoHostPath)) ??
    props.activeRepo?.name ??
    props.activeProject?.name ??
    ''
  // `repoSeleccionado` y no `repoHostPath` (que cae a la contenedora): «aquí no hay git»
  // lo dice el escaneo, y solo cuando terminó (`repos !== null`).
  const sinRepo = repoSeleccionado === null && props.repos !== null
  return (
    <section className="git-log-panel git-ui" aria-label="Historial de git" style={props.varsDensidad}>
      <CabeceraLog
        nombreRepo={nombreRepo}
        cargando={e.datos.cargando}
        recargarDeshabilitado={e.datos.cargando || projectHostPath === null || !props.anclado}
        onRecargar={e.recargar}
        pantallaCompleta={props.pantallaCompleta}
        onPantallaCompleta={props.onPantallaCompleta}
        onClose={props.onClose}
      />
      {projectHostPath === null ? (
        <EstadoVacio
          icono={<IconoCarpetaVacia />}
          titulo="Sin proyecto abierto"
          pista="Abre un proyecto para ver su historial de git."
        />
      ) : sinRepo ? (
        <EstadoVacio
          icono={<IconoGitVacio />}
          titulo="Esto no es un repositorio de git"
          pista="La carpeta abierta no está versionada, así que no hay historial que enseñar. Abre un proyecto con git para ver sus commits y sus ramas."
        />
      ) : (
        <ContenidoLog props={props} e={e} />
      )}
    </section>
  )
}
