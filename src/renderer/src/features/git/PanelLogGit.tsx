// =============================================================================
// PanelLogGit: la ventana «Git · Log» de la franja inferior, en tres columnas: ramas,
// filtros con grafo y commits, y archivos con el detalle del commit. Aquí vive toda la
// historia; el sidebar se queda con el working tree. Se monta bajo demanda: las cachés
// de módulo de `modelo/cacheGit` hacen que reabrir sea instantáneo.
// El estado y los efectos están en `useEstadoLog`; este archivo solo compone y pinta.
// Decisiones: docs/decisiones/git/log-identidad-y-anclaje.md
// =============================================================================

import { Presente } from '../../comun/Presente'
import { useUltimoValor } from '../../comun/presencia'
import { useLayoutEffect, useRef } from 'react'
import { documentoDe } from '../../util/ventanaDe'
import { EstadoVacio, IconoCarpetaVacia } from '../../comun/EstadoVacio'
import { Divisor } from '../../comun/Divisor'
import { Modal } from '../../comun/Modal'
import { IconoCerrar } from '../../comun/iconosMenu'
import { ArbolRamas } from './ArbolRamas'
import { DetalleCommit } from './DetalleCommit'
import { asegurarEstilosGit } from './estilosGit'
import { HistorialArchivo } from './HistorialArchivo'
import { BotonMaximizarPanel, type MenuMaximizar } from '../../comun/BotonMaximizarPanel'
import { IconoOcultarPanel } from '../../comun/iconosPanel'
import { etiquetaAcorde } from '../../util/atajos'
import { IconoGitVacio, IconoRecargar } from './iconos'
import { ColumnaCentro } from './ListaCommits'
import { txGit } from './textos.ts'
import { useEstadoLog, type EstadoLog } from './useEstadoLog'
import type { OrigenApertura } from './useSeleccionLog'
import type { PaneDiffEditor, DestinoDiff } from '../editor'
import type { RepoDetectado } from '../../../../shared/workspace-ipc'
import type { ProyectoAbiertoDePerfil } from '../pestanas'

export interface PropsPanelLogGit {
  oculta?: boolean
  /** Lo que la franja añade tras el reinicio y un filete (ventana desacoplada, o desacoplar a pantalla completa). */
  accionFranja?: React.ReactNode
  /** Con él, maximizar es un botón dividido que ofrece también lo que añade la franja. */
  menuMaximizar?: MenuMaximizar
  /** Alto de fila en px (theme/densidad; el mismo que ve el CSS). */
  altoFila: number
  /**
   * Variables CSS de densidad de ESTA superficie: se escriben en la raíz del panel, no en
   * `:root`. Salen del mismo número que `altoFila` o el scroll de las listas se descuadra.
   */
  variablesDensidad?: React.CSSProperties
  /** Reparto vertical de la tercera columna: cuánto se lleva la lista de archivos. */
  altoArchivos: number
  minArchivos: number
  onAltoArchivos: (px: number) => void
  /**
   * Proyecto y repo que se están MOSTRANDO (los del perfil activo). Cada petición los lleva y el
   * main la atiende en ese proyecto, así que se pide en cuanto se conocen.
   */
  proyectoActivo: ProyectoAbiertoDePerfil | null
  repoActivo: RepoDetectado | null
  repos: RepoDetectado[] | null
  onSeleccionarRepo: (rutaHostRepo: string) => void
  /**
   * Sube el diff armado al abrir un archivo de un commit; el colapso lo decide la franja, y
   * con el `origen` también qué se hace a pantalla completa (`aperturaDesdeGit`).
   */
  onAbrirDiff: (destino: DestinoDiff, origen: OrigenApertura) => void
  /** Cierra la franja (botón × del header). */
  onCerrar: () => void
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
  /** Con el Log desacoplado, tope de la lista del historial en la ventana principal. */
  maxHistorialPrincipal?: number
  /** Cierra la pestaña del historial y vuelve al log. */
  onCerrarHistorial: () => void
  /** Ancho de la lista del historial: solo de sesión, no se escribe en los ajustes. */
  anchoHistorial: number
  onAnchoHistorial: (px: number) => void
  /** Botones del visor de diff del historial: pasan de largo, este panel no los usa. */
  onSaltarAlFuente: (destino: DestinoDiff, linea: number) => void
  /** El visor de diff del editor, para el historial; ver `PropsHistorialArchivo.VisorDiff`. */
  VisorDiff: typeof PaneDiffEditor
  colapsarSinCambios: boolean
  onColapsarSinCambios: (valor: boolean) => void
}

function CabeceraLog(p: {
  accionFranja?: React.ReactNode
  menuMaximizar?: MenuMaximizar
  nombreRepo: string
  cargando: boolean
  recargarDeshabilitado: boolean
  onRecargar: () => void
  pantallaCompleta: boolean
  onPantallaCompleta: (valor: boolean) => void
  onCerrar: () => void
}): React.JSX.Element {
  const t = txGit()
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
          title={t.recargarHistorial}
          aria-label={t.recargarHistorial}
        >
          <IconoRecargar girando={p.cargando} />
        </button>
        {(!p.pantallaCompleta || p.accionFranja) && <span className="panel-actions-sep" aria-hidden="true" />}
        {p.pantallaCompleta && p.accionFranja}
        {/* A pantalla completa, restaurar y ocultar son del modo y viven en el riel (`RielPantallaCompleta`). */}
        {!p.pantallaCompleta && (
          <>
            <BotonMaximizarPanel
              etiqueta={t.maximizarPanel}
              titulo={`${t.maximizarTitulo} (${etiquetaAcorde('pantallaCompleta')})`}
              claseBoton="git-icon-btn"
              menu={p.menuMaximizar}
              alMaximizar={() => p.onPantallaCompleta(true)}
            />
            <button className="git-icon-btn" onClick={p.onCerrar} title={t.ocultarPanel} aria-label={t.ocultarPanel}>
              <IconoOcultarPanel />
            </button>
          </>
        )}
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
  const t = txGit()
  return (
    <div className="git-vistas-tabs" role="tablist" aria-label={t.vistasGit}>
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
        {t.historialDe(historial.slice(historial.lastIndexOf('/') + 1))}
        <span
          className="git-vista-tab-cerrar"
          role="button"
          aria-label={t.cerrarHistorial}
          title={t.cerrarHistorial}
          onClick={(ev) => {
            ev.stopPropagation()
            p.onCerrarHistorial()
          }}
        >
          <IconoCerrar />
        </span>
      </button>
    </div>
  )
}

/** Las tres columnas: ramas, centro y detalle del commit. */
function CuerpoLog({ props, e }: { props: PropsPanelLogGit; e: EstadoLog }): React.JSX.Element {
  const { commitSeleccionado, copia } = e
  return (
    <div className="git-log-body">
      <ArbolRamas
        ramas={e.datos.ramas}
        ramaActiva={e.filtros.rama}
        repos={props.repos}
        etiquetasRepos={e.etiquetasRepos}
        repoActivo={e.id.rutaHostRepo}
        onSeleccionarRama={e.seleccionarRama}
        onSeleccionarRepo={props.onSeleccionarRepo}
      />
      <Divisor
        orientacion="vertical"
        className="splitter-hueco"
        tamano={props.anchoRamas}
        min={props.colMin}
        max={props.colMax}
        direccion={1}
        onRedimensionar={props.onAnchoRamas}
        etiqueta={txGit().anchoRamas}
      />
      <ColumnaCentro
        e={e}
        altoFila={props.altoFila}
        consulta={props.consulta}
        onConsulta={props.onConsulta}
      />
      <Divisor
        orientacion="vertical"
        className="splitter-hueco"
        tamano={props.anchoDetalle}
        min={props.colMin}
        max={props.colMax}
        // Arrastrar hacia la IZQUIERDA agranda la columna de detalle, que está a la derecha.
        direccion={-1}
        onRedimensionar={props.onAnchoDetalle}
        etiqueta={txGit().anchoDetalle}
      />
      <DetalleCommit
        commit={commitSeleccionado}
        rutaHostRepo={e.id.rutaHostRepo}
        altoFila={props.altoFila}
        altoArchivos={props.altoArchivos}
        minArchivos={props.minArchivos}
        onAltoArchivos={props.onAltoArchivos}
        rutaSeleccionada={e.sel.rutaSeleccionada}
        onSeleccionarArchivo={e.seleccionarArchivo}
        onAbrirDiff={e.apertura.abrirDiffManual}
        onFilasArchivos={e.apertura.recibirFilas}
        revelarArchivo={e.sel.revelarArchivo}
        onTeclaAbajoArchivos={e.teclas.teclasArchivos}
        alternarCarpetaRef={e.sel.alternarCarpetaRef}
        copiado={commitSeleccionado !== null && commitSeleccionado.hash === copia.hashCopiado}
        onCopiarHash={() => {
          if (commitSeleccionado) copia.copiarHashDeCommit(commitSeleccionado.hash)
        }}
      />
    </div>
  )
}

function HistorialEnPrincipal({ ruta, token, variablesDensidad, cerrar, children }: {
  ruta: string
  token: number
  variablesDensidad?: React.CSSProperties
  cerrar: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const cuerpo = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    window.focus()
    cuerpo.current?.focus({ preventScroll: true })
  }, [ruta, token])
  return (
    <Modal titulo={txGit().historialDe(ruta.slice(ruta.lastIndexOf('/') + 1))} tamano="xl"
      cuerpoClassName="git-historial-modal" documento={document} onCerrar={cerrar}>
      <div ref={cuerpo} className="git-ui git-historial-modal-contenido" style={variablesDensidad} tabIndex={-1}>
        {children}
      </div>
    </Modal>
  )
}

/** Pestañas (si hay historial abierto) y la vista elegida: historial del archivo o log. */
function ContenidoLog({ props, e }: { props: PropsPanelLogGit; e: EstadoLog }): React.JSX.Element {
  const { historial } = props
  const ultimoHistorial = useUltimoValor(historial)
  const { vistaHistorial, setVistaHistorial } = e.historial
  const enPrincipal = props.maxHistorialPrincipal !== undefined
  const colMax = props.maxHistorialPrincipal ?? props.colMax
  const cerrarVista = (): void => setVistaHistorial(false)
  const visor = vistaHistorial && historial !== null && (!enPrincipal || !props.oculta) ? (
    <HistorialArchivo
      key={historial}
      ruta={historial}
      altoFila={props.altoFila}
      anchoLista={Math.min(props.anchoHistorial, colMax)}
      onAnchoLista={props.onAnchoHistorial}
      colMin={props.colMin}
      colMax={colMax}
      onAbrirEnEditor={(destino) => {
        if (enPrincipal) cerrarVista()
        props.onAbrirDiff(destino, 'manual')
      }}
      onSaltarAlFuente={(destino, linea) => {
        if (enPrincipal) cerrarVista()
        props.onSaltarAlFuente(destino, linea)
      }}
      VisorDiff={props.VisorDiff}
      colapsarSinCambios={props.colapsarSinCambios}
      onColapsarSinCambios={props.onColapsarSinCambios}
    />
  ) : null
  return (
    <>
      <Presente visible={historial !== null} className="mov-despliega">
        <PestanasVistas
          historial={ultimoHistorial ?? ''}
          vistaHistorial={vistaHistorial}
          setVistaHistorial={setVistaHistorial}
          onCerrarHistorial={props.onCerrarHistorial}
        />
      </Presente>
      {enPrincipal || !visor ? <CuerpoLog props={props} e={e} /> : visor}
      {enPrincipal && historial !== null && visor && (
        <HistorialEnPrincipal ruta={historial} token={props.historialToken} variablesDensidad={props.variablesDensidad} cerrar={cerrarVista}>
          {visor}
        </HistorialEnPrincipal>
      )}
    </>
  )
}

export function PanelLogGit(props: PropsPanelLogGit): React.JSX.Element {
  const panelRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    asegurarEstilosGit()
    const doc = documentoDe(panelRef.current)
    if (doc !== document) asegurarEstilosGit(doc)
  }, [])
  const t = txGit()
  const e = useEstadoLog(props)
  const { rutaHostProyecto, repoSeleccionado, rutaHostRepo } = e.id
  const nombreRepo =
    (rutaHostRepo && e.etiquetasRepos.get(rutaHostRepo)) ??
    props.repoActivo?.name ??
    props.proyectoActivo?.nombre ??
    ''
  // `repoSeleccionado` y no `rutaHostRepo` (que cae a la contenedora): «aquí no hay git»
  // lo dice el escaneo, y solo cuando terminó (`repos !== null`).
  const sinRepo = repoSeleccionado === null && props.repos !== null
  return (
    <section ref={panelRef} className={`git-log-panel git-ui${props.oculta ? ' hidden' : ''}`}
      aria-hidden={props.oculta} aria-label={t.panelHistorial} style={props.variablesDensidad}>
      <CabeceraLog
        nombreRepo={nombreRepo}
        cargando={e.datos.cargando}
        recargarDeshabilitado={e.datos.cargando || rutaHostProyecto === null}
        onRecargar={e.recargar}
        accionFranja={props.accionFranja}
        menuMaximizar={props.menuMaximizar}
        pantallaCompleta={props.pantallaCompleta}
        onPantallaCompleta={props.onPantallaCompleta}
        onCerrar={props.onCerrar}
      />
      {rutaHostProyecto === null ? (
        <EstadoVacio
          icono={<IconoCarpetaVacia />}
          titulo={t.sinProyectoTitulo}
          pista={t.sinProyectoHistorial}
        />
      ) : sinRepo ? (
        <EstadoVacio
          icono={<IconoGitVacio />}
          titulo={t.noEsRepoTitulo}
          pista={t.noEsRepoHistorial}
        />
      ) : (
        <ContenidoLog props={props} e={e} />
      )}
    </section>
  )
}
