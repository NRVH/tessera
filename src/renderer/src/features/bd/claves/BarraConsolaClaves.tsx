// =============================================================================
// La barra de la consola de Redis: alias, entorno, base y estado a la izquierda; iconos grises
// a la derecha, con el historial como en la consola de MongoDB. Sin transacción ni plan: en la consola no
// existen (un MULTI se escribe a mano) y un botón apagado para siempre es ruido. Hay selector de base salvo en Cluster.
// Depende de `documentos/piezasBarra` y de `useBarraConsola`, que llevan lo común con la de MongoDB.
// =============================================================================

import type { DbConnection } from '../../../../../shared/db-ipc'
import { etiquetaAcorde, etiquetasAcorde } from '../../../util/atajos'
import { IconoHistorial } from '../../../comun/iconosMenu'
import { etiquetaBaseClaves } from '../arbolClaves'
import { IconoDetener, IconoEjecutar, IconoEjecutarTodo } from '../iconosBd'
import type { EnCurso } from '../documentos/consolaComun'
import { BotonBase, BotonCandado, BotonIcono, IdentidadBarra } from '../documentos/piezasBarra'
import { useBarraConsola, type DatosBarraConsola } from '../documentos/useBarraConsola'
import { SelectorBaseClaves } from './SelectorBaseClaves'

/** ¿Es una conexión de Redis Cluster? (Solo la base 0.) */
function esCluster(c: DbConnection): boolean {
  return c.topologiaRedis?.modo === 'cluster'
}

interface PropsBarraConsolaClaves {
  conexion: DbConnection
  base: number
  altoFila: number
  enCurso: EnCurso | null
  cargado: boolean
  textoEstado: string | null
  onEjecutar: () => void
  onEjecutarTodo: () => void
  onDetener: () => void
  onElegirBase: (base: number) => void
  onEditarConexion: () => void
  /** Abre o cierra el popover del historial (lo pinta el pane). */
  onHistorial: () => void
  historialAbierto: boolean
}

function BotonesEjecucion({ p, b }: { p: PropsBarraConsolaClaves; b: DatosBarraConsola }): React.JSX.Element {
  return (
    <>
      <BotonIcono
        className="db-consola-run"
        titulo={`Ejecutar el comando del cursor o las líneas seleccionadas · ${etiquetaAcorde('ejecutar')}`}
        etiqueta="Ejecutar"
        habilitado={b.puedeEjecutar}
        motivo={b.motivoEjecutar}
        onClick={p.onEjecutar}
      >
        <IconoEjecutar />
      </BotonIcono>
      <BotonIcono
        className="db-consola-run-todo"
        titulo={`Ejecutar todos los comandos · ${etiquetasAcorde('ejecutarTodo').join(' o ')}`}
        etiqueta="Ejecutar todo"
        habilitado={b.puedeEjecutar}
        motivo={b.motivoEjecutar}
        onClick={p.onEjecutarTodo}
      >
        <IconoEjecutarTodo />
      </BotonIcono>
      <BotonIcono
        className="db-consola-detener"
        titulo={`Detener · ${etiquetaAcorde('detener')}`}
        etiqueta="Detener"
        habilitado={b.corriendo}
        motivo="No hay nada en ejecución"
        onClick={p.onDetener}
      >
        <IconoDetener />
      </BotonIcono>
      {/* Un <button> propio por `aria-expanded` y el `mousedown`: sin cortarlo, el «clic fuera»
          del popover abierto lo cerraría y este clic lo volvería a abrir. */}
      <button
        type="button"
        className={`btn btn-icon db-consola-historial-btn${p.historialAbierto ? ' activo' : ''}`}
        title={`Historial de comandos · ${etiquetaAcorde('historial')}`}
        aria-label="Historial de comandos"
        aria-haspopup="dialog"
        aria-expanded={p.historialAbierto}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={p.onHistorial}
      >
        <IconoHistorial />
      </button>
    </>
  )
}

function AccionesClaves({ p, b }: { p: PropsBarraConsolaClaves; b: DatosBarraConsola }): React.JSX.Element {
  const nombreBase = etiquetaBaseClaves(p.base)
  const tituloBase = b.corriendo ? 'Espera a que termine la ejecución para cambiar la base' : `Base: ${nombreBase}. Pulsa para cambiar`
  return (
    <div className="panel-actions">
      <BotonesEjecucion p={p} b={b} />
      <span className="panel-actions-sep" aria-hidden="true" />
      {/* En Cluster solo existe la base 0: no hay nada que elegir. */}
      {!esCluster(p.conexion) && (
        <BotonBase
          corriendo={b.corriendo}
          titulo={tituloBase}
          etiqueta={`Base de la consola: ${nombreBase}`}
          abierto={b.ancla !== null}
          botonRef={b.botonBaseRef}
          onAbrir={b.abrirBase}
        />
      )}
      {p.conexion.readonly && <BotonCandado onEditarConexion={p.onEditarConexion} />}
    </div>
  )
}

/** La barra de la consola de Redis, con el selector de base anclado a su botón. */
export function BarraConsolaClaves(p: PropsBarraConsolaClaves): React.JSX.Element {
  const b = useBarraConsola(p.enCurso, p.cargado, p.textoEstado)
  const nombreBase = etiquetaBaseClaves(p.base)
  const produccion = p.conexion.entorno === 'produccion'
  return (
    <div className={`panel-header db-consola-barra${produccion ? ' db-consola-barra-produccion' : ''}`}>
      <IdentidadBarra conexion={p.conexion} estado={b.estado} anunciado={b.anunciado}>
        <span
          className="db-consola-dato db-consola-esquema"
          title={esCluster(p.conexion) ? 'Cluster: solo existe la base 0' : `Base actual: ${nombreBase} (también la cambia «SELECT n»)`}
        >
          {nombreBase}
        </span>
      </IdentidadBarra>
      <AccionesClaves p={p} b={b} />
      {b.ancla && (
        <SelectorBaseClaves
          conexion={p.conexion}
          actual={p.base}
          ancla={b.ancla}
          altoFila={p.altoFila}
          onElegir={p.onElegirBase}
          onCerrar={b.cerrarSelector}
        />
      )}
    </div>
  )
}
