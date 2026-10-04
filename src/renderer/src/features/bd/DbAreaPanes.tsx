// =============================================================================
// DbAreaPanes: lo que `DbArea` pinta en `.db-panes`, como funciones que devuelven
// elementos (no componentes: el árbol de React y el DOM quedan como si estuvieran en línea
// en `DbArea`, y ningún pane se remonta). Cada
// pestaña montada va en su caja `.db-pane` con su `ErrorBoundary`, con el pane que
// toca por la FAMILIA de su conexión; y el estado vacío del perfil que se ve.
// Decisiones: docs/decisiones/bd/ui-area-pestanas-y-panes.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc'
import type { DbRefObjeto, DbTxModo } from '../../../../shared/db-explorador-ipc'
import { descriptor, esDeClaves, esDeDocumentos, esMotorSql } from '../../../../shared/motores/index'
import { pestanaActiva, type DbPane, type DbPaneObjeto, type DbTab } from './dbTabsModel'
import { motivoSinConsola, vacioAreaSinConexiones } from './filasArbolBd'
import type { DbVistaApi, PestanaBdMontada } from './useDbVista'
import type { AreaPorPane } from './useAreaPorPane'
import { etiquetaAbrirNodo, etiquetaAcorde } from '../../util/atajos'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { DbDatosPane } from './DbDatosPane'
import { DbFuentePane } from './DbFuentePane'
import { DbConsolaPane } from './DbConsolaPane'
import { DbColeccionPane } from './documentos/DbColeccionPane'
import { DbConsolaDocsPane } from './documentos/DbConsolaDocsPane'
import { DbClavePane } from './claves/DbClavePane'
import { DbConsolaClavesPane } from './claves/DbConsolaClavesPane'
import { IconoBd } from './iconosBd'

/** Lo que los panes reciben del área, igual para todos. */
interface ContextoPanes {
  vista: DbVistaApi
  /** Perfil que se ve, o null. */
  perfilId: string | null
  oculta: boolean
  altoFila: number
  altoResultados: number
  onAltoResultados: (px: number) => void
  filasPorPagina: number
  txInicial: DbTxModo
  onAbrirConsola: (perfilId: string, conexionId: string, textoInicial?: string) => void
  onEditarConexion: (conexionId: string) => void
  porPane: AreaPorPane
}

/** El pane que se está pintando: dónde vive y con qué conexión. */
interface PaneEnCurso {
  pid: string
  pk: string
  conexion: DbConnection
  visible: boolean
  abrirConsola: (conexionId: string, textoInicial?: string) => void
}

/** La familia de la conexión, que elige el pane. */
interface Familia {
  deDocumentos: boolean
  deClaves: boolean
  deSql: boolean
}

function noDisponible(pista: string): React.JSX.Element {
  return <EstadoVacio icono={<IconoBd />} titulo="Pestaña no disponible" pista={pista} />
}

function consolaPane(
  pane: Extract<DbPane, { kind: 'consola' }>,
  p: PaneEnCurso,
  ctx: ContextoPanes,
  f: Familia
): React.JSX.Element | null {
  if (!f.deDocumentos && !f.deClaves && !f.deSql) return noDisponible('Esta pestaña es de SQL y la conexión no lo es.')
  const consola = ctx.porPane.consolaDe(p.pid, pane.consolaId, p.pk)
  if (consola === null) return null
  const comunes = {
    paneKey: p.pk,
    perfilId: p.pid,
    consola,
    conexion: p.conexion,
    visible: p.visible,
    altoFila: ctx.altoFila,
    altoResultados: ctx.altoResultados,
    onAltoResultados: ctx.onAltoResultados
  }
  if (f.deDocumentos) {
    return (
      <DbConsolaDocsPane
        {...comunes}
        filasPorPagina={ctx.filasPorPagina}
        onIndicador={ctx.porPane.onIndicadorDe(p.pk)}
        onEditarConexion={ctx.onEditarConexion}
      />
    )
  }
  if (f.deClaves) {
    return (
      <DbConsolaClavesPane {...comunes} onIndicador={ctx.porPane.onIndicadorDe(p.pk)} onEditarConexion={ctx.onEditarConexion} />
    )
  }
  return (
    <DbConsolaPane
      {...comunes}
      filasPorPagina={ctx.filasPorPagina}
      txInicial={ctx.txInicial}
      onIndicador={ctx.porPane.onIndicadorDe(p.pk)}
      onEditarConexion={ctx.onEditarConexion}
    />
  )
}

function objetoPane(pane: DbPaneObjeto, p: PaneEnCurso, ctx: ContextoPanes): React.JSX.Element {
  const objeto: DbRefObjeto = {
    esquema: pane.esquema,
    nombre: pane.objeto,
    tipo: pane.tipo,
    ...(pane.kind === 'fuente' && pane.firma !== undefined ? { firma: pane.firma } : {}),
    // La base, solo en una conexión con nivel «Bases».
    ...(pane.base !== undefined ? { base: pane.base } : {})
  }
  if (pane.kind === 'datos') {
    return (
      <DbDatosPane
        paneKey={p.pk}
        conexion={p.conexion}
        objeto={objeto}
        visible={p.visible}
        altoFila={ctx.altoFila}
        filasPorPagina={ctx.filasPorPagina}
        onIndicador={ctx.porPane.onIndicadorDe(p.pk)}
        onAbrirConsola={p.abrirConsola}
        onAbrir={(dp: DbPane): void => ctx.vista.abrir(p.pid, dp)}
      />
    )
  }
  return (
    <DbFuentePane
      paneKey={p.pk}
      conexion={p.conexion}
      objeto={objeto}
      modo={pane.modo === 'ddl' ? 'ddl' : 'fuente'}
      visible={p.visible}
      onAbrirConsola={p.abrirConsola}
    />
  )
}

/**
 * El contenido del pane según su tipo y la familia de su conexión; null si su consola
 * aún no se conoce (entonces no se monta nada). Lo que no cuadre (una pestaña SQL sobre
 * Redis, una clave sobre MongoDB), que el árbol no abre pero podría llegar restaurado,
 * se dice en vez de montar el pane ajeno.
 */
function contenidoPane(pane: DbPane, p: PaneEnCurso, ctx: ContextoPanes): React.JSX.Element | null {
  const f: Familia = {
    deDocumentos: esDeDocumentos(descriptor(p.conexion.motor)),
    deClaves: esDeClaves(descriptor(p.conexion.motor)),
    deSql: esMotorSql(p.conexion.motor)
  }
  const sinPestana = motivoSinConsola(p.conexion)
  if (sinPestana !== null) return noDisponible(sinPestana)
  if (pane.kind === 'coleccion') {
    if (!f.deDocumentos) return noDisponible('Esta conexión no es de documentos.')
    return (
      <DbColeccionPane
        paneKey={p.pk}
        conexion={p.conexion}
        base={pane.base}
        coleccion={pane.coleccion}
        visible={p.visible}
        altoFila={ctx.altoFila}
        filasPorPagina={ctx.filasPorPagina}
        onIndicador={ctx.porPane.onIndicadorDe(p.pk)}
        onAbrirConsola={p.abrirConsola}
      />
    )
  }
  if (pane.kind === 'clave') {
    // El visor es de lectura: no pregunta al cerrarse (no entra en `registroEdicion`).
    if (!f.deClaves) return noDisponible('Esta conexión no es de claves.')
    return (
      <DbClavePane
        paneKey={p.pk}
        conexion={p.conexion}
        base={pane.base}
        clave={pane.clave}
        nombre={pane.nombre}
        visible={p.visible}
        altoFila={ctx.altoFila}
        onIndicador={ctx.porPane.onIndicadorDe(p.pk)}
        onAbrirConsola={p.abrirConsola}
      />
    )
  }
  if (pane.kind === 'consola') return consolaPane(pane, p, ctx, f)
  if (!f.deSql) return noDisponible('Esta pestaña es de SQL y la conexión no lo es.')
  return objetoPane(pane, p, ctx)
}

/**
 * La caja de una pestaña montada (de cualquier perfil), oculta si no es la que se ve; null
 * mientras su conexión o su consola no se conozcan (la pestaña ya está en la tira).
 */
export function paneDeArea({ perfilId: pid, tab, paneKey: pk }: PestanaBdMontada, ctx: ContextoPanes): React.JSX.Element | null {
  const activaDelPerfil = pestanaActiva(ctx.vista.vistaDe(pid).pestanas)
  const visible = !ctx.oculta && pid === ctx.perfilId && activaDelPerfil?.id === tab.id
  const conexion = ctx.porPane.conexionDe(pid, tab.pane.conexionId, pk)
  if (conexion === null) return null
  const abrirConsola = (conexionId: string, textoInicial?: string): void => ctx.onAbrirConsola(pid, conexionId, textoInicial)
  const contenido = contenidoPane(tab.pane, { pid, pk, conexion, visible, abrirConsola }, ctx)
  if (contenido === null) return null
  return (
    <div key={pk} className={`db-pane${visible ? '' : ' hidden'}`}>
      <ErrorBoundary key={pk} label="la pestaña de datos" variant="pane">
        {contenido}
      </ErrorBoundary>
    </div>
  )
}

/** Lo que decide el estado vacío del perfil que se ve. */
interface DatosVacio {
  perfilId: string | null
  tabs: readonly DbTab[]
  cargandoConexiones: boolean
  hayAjenas: boolean
  avisoFormato: string | null
  conexionesActuales: readonly DbConnection[] | null
  onNuevaConexion: () => void
}

function vacioSinConexiones(d: DatosVacio): React.JSX.Element {
  // Con solo ajenas no afirma de qué causa es cada una, y con un registro que no se
  // entiende enseña su aviso y NO ofrece el alta, que el main rechazaría.
  const sinConexiones = vacioAreaSinConexiones({ hayAjenas: d.hayAjenas, avisoFormato: d.avisoFormato })
  return (
    <EstadoVacio
      icono={<IconoBd />}
      titulo={sinConexiones.titulo}
      pista={
        sinConexiones.nota === null ? (
          sinConexiones.pista
        ) : (
          <>
            {sinConexiones.pista}
            <span className="db-area-vacio-nota">{sinConexiones.nota}</span>
          </>
        )
      }
      accion={
        sinConexiones.ofrecerAlta ? (
          <button className="btn" onClick={d.onNuevaConexion}>
            Nueva conexión…
          </button>
        ) : undefined
      }
    />
  )
}

/**
 * El estado vacío del perfil que se ve, o null. Mientras el registro no responde no se
 * enseña nada: un «Cargando…» saltaría al llegar la lista y «Sin conexiones» sería falso.
 */
export function vacioDeArea(d: DatosVacio): React.JSX.Element | null {
  if (d.perfilId === null) {
    return <EstadoVacio icono={<IconoBd />} titulo="Sin perfil activo" pista="Abre un perfil para ver sus conexiones." />
  }
  if (d.tabs.length !== 0 || d.cargandoConexiones) return null
  if ((d.conexionesActuales?.length ?? 0) === 0) return vacioSinConexiones(d)
  return (
    <EstadoVacio
      icono={<IconoBd />}
      titulo="Ninguna tabla abierta"
      pista={`Abre una tabla o una vista del árbol con ${etiquetaAbrirNodo()}, o una consola SQL con ${etiquetaAcorde('nuevaConsola')}.`}
    />
  )
}
