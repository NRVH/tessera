// =============================================================================
// DbAreaPanes: lo que `DbArea` pinta en `.db-panes`, como funciones que devuelven
// elementos (no componentes: el árbol de React y el DOM quedan como si estuvieran en línea
// en `DbArea`, y ningún pane se remonta). Cada
// pestaña montada va en su caja `.db-pane` con su `ErrorBoundary`, con el pane que
// toca por la FAMILIA de su conexión; y el estado vacío del perfil que se ve.
// Decisiones: docs/decisiones/bd/ui-area-pestanas-y-panes.md
// =============================================================================

import type { ConexionBd } from '../../../../shared/db-ipc'
import type { DbRefObjeto, DbTxModo } from '../../../../shared/db-explorador-ipc'
import { descriptor, esDeClaves, esDeDocumentos, esMotorSql } from '../../../../shared/motores/index'
import { idDbPane, pestanaActiva, type DbPane, type DbPaneObjeto, type PestanaBd } from './modeloPestanasBd'
import { motivoSinConsola, vacioAreaSinConexiones } from './filasArbolBd'
import type { DbVistaApi, PestanaBdMontada } from './useDbVista'
import type { AreaPorPane } from './useAreaPorPane'
import { etiquetaAbrirNodo, etiquetaAcorde } from '../../util/atajos'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { DbDatosPane } from './DbDatosPane'
import { DbFuentePane } from './DbFuentePane'
import { DbConsolaPane } from './DbConsolaPane'
import type { AbrirConsolaEn, BaseConsolaNueva } from './consola/basesConsola'
import { PaneColeccionBd } from './documentos/PaneColeccionBd'
import { PaneConsolaDocsBd } from './documentos/PaneConsolaDocsBd'
import { PaneClaveBd } from './claves/PaneClaveBd'
import { PaneConsolaClavesBd } from './claves/PaneConsolaClavesBd'
import { IconoBd } from './iconosBd'
import { txArea } from './textosArea.ts'

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
  onAbrirConsola: (perfilId: string, conexionId: string, textoInicial?: string, base?: BaseConsolaNueva) => void
  onEditarConexion: (conexionId: string) => void
  porPane: AreaPorPane
}

/** El pane que se está pintando: dónde vive y con qué conexión. */
interface PaneEnCurso {
  pid: string
  pk: string
  conexion: ConexionBd
  visible: boolean
  abrirConsola: AbrirConsolaEn
}

/** La familia de la conexión, que elige el pane. */
interface Familia {
  deDocumentos: boolean
  deClaves: boolean
  deSql: boolean
}

function noDisponible(pista: string): React.JSX.Element {
  return <EstadoVacio icono={<IconoBd />} titulo={txArea().pestanaNoDisponible} pista={pista} />
}

function consolaPane(
  pane: Extract<DbPane, { tipoPane: 'consola' }>,
  p: PaneEnCurso,
  ctx: ContextoPanes,
  f: Familia
): React.JSX.Element | null {
  if (!f.deDocumentos && !f.deClaves && !f.deSql) return noDisponible(txArea().pestanaSqlNoSql)
  const consola = ctx.porPane.consolaDe(p.pid, pane.consolaId, p.pk)
  if (consola === null) return null
  const comunes = {
    clavePane: p.pk,
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
      <PaneConsolaDocsBd
        {...comunes}
        filasPorPagina={ctx.filasPorPagina}
        onIndicador={ctx.porPane.onIndicadorDe(p.pk)}
        onEditarConexion={ctx.onEditarConexion}
      />
    )
  }
  if (f.deClaves) {
    return (
      <PaneConsolaClavesBd {...comunes} onIndicador={ctx.porPane.onIndicadorDe(p.pk)} onEditarConexion={ctx.onEditarConexion} />
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
    ...(pane.tipoPane === 'fuente' && pane.firma !== undefined ? { firma: pane.firma } : {}),
    // La base, solo en una conexión con nivel «Bases».
    ...(pane.base !== undefined ? { base: pane.base } : {})
  }
  if (pane.tipoPane === 'datos') {
    return (
      <DbDatosPane
        clavePane={p.pk}
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
      clavePane={p.pk}
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
  if (pane.tipoPane === 'coleccion') {
    if (!f.deDocumentos) return noDisponible(txArea().noEsDeDocumentos)
    return (
      <PaneColeccionBd
        clavePane={p.pk}
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
  if (pane.tipoPane === 'clave') {
    // Cada edición del visor se ejecuta al aceptar su diálogo: no pregunta al cerrarse (no entra en `registroEdicion`).
    if (!f.deClaves) return noDisponible(txArea().noEsDeClaves)
    return (
      <PaneClaveBd
        clavePane={p.pk}
        conexion={p.conexion}
        base={pane.base}
        clave={pane.clave}
        nombre={pane.nombre}
        visible={p.visible}
        altoFila={ctx.altoFila}
        onIndicador={ctx.porPane.onIndicadorDe(p.pk)}
        onAbrirConsola={p.abrirConsola}
        onRenombrada={(clave, nombre) => ctx.vista.reemplazar(p.pid, idDbPane(pane), { ...pane, clave, nombre })}
      />
    )
  }
  if (pane.tipoPane === 'consola') return consolaPane(pane, p, ctx, f)
  if (!f.deSql) return noDisponible(txArea().pestanaSqlNoSql)
  return objetoPane(pane, p, ctx)
}

/**
 * La caja de una pestaña montada (de cualquier perfil), oculta si no es la que se ve; null
 * mientras su conexión o su consola no se conozcan (la pestaña ya está en la tira).
 */
export function paneDeArea({ perfilId: pid, pestana, clavePane: pk }: PestanaBdMontada, ctx: ContextoPanes): React.JSX.Element | null {
  const activaDelPerfil = pestanaActiva(ctx.vista.vistaDe(pid).pestanas)
  const visible = !ctx.oculta && pid === ctx.perfilId && activaDelPerfil?.id === pestana.id
  const conexion = ctx.porPane.conexionDe(pid, pestana.pane.conexionId, pk)
  if (conexion === null) return null
  const abrirConsola: AbrirConsolaEn = (conexionId, textoInicial, base) => ctx.onAbrirConsola(pid, conexionId, textoInicial, base)
  const contenido = contenidoPane(pestana.pane, { pid, pk, conexion, visible, abrirConsola }, ctx)
  if (contenido === null) return null
  return (
    <div key={pk} className={`db-pane${visible ? '' : ' hidden'}`}>
      <ErrorBoundary key={pk} etiqueta={txArea().laPestanaDeDatos} variante="pane">
        {contenido}
      </ErrorBoundary>
    </div>
  )
}

/** Lo que decide el estado vacío del perfil que se ve. */
interface DatosVacio {
  perfilId: string | null
  pestanas: readonly PestanaBd[]
  cargandoConexiones: boolean
  hayAjenas: boolean
  avisoFormato: string | null
  conexionesActuales: readonly ConexionBd[] | null
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
            {txArea().nuevaConexion}
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
  const t = txArea()
  if (d.perfilId === null) {
    return <EstadoVacio icono={<IconoBd />} titulo={t.sinPerfilTitulo} pista={t.sinPerfilPista} />
  }
  if (d.pestanas.length !== 0 || d.cargandoConexiones) return null
  if ((d.conexionesActuales?.length ?? 0) === 0) return vacioSinConexiones(d)
  return (
    <EstadoVacio
      icono={<IconoBd />}
      titulo={t.ningunaTablaTitulo}
      pista={t.ningunaTablaPista(etiquetaAbrirNodo(), etiquetaAcorde('nuevaConsola'))}
    />
  )
}
