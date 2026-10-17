// =============================================================================
// La barra de la consola de MongoDB: alias, entorno, base y estado a la izquierda; iconos
// grises a la derecha, con el historial como en la consola SQL. Sin transacción ni plan: no
// existen en esta consola y un botón apagado para siempre es ruido. Con la base fijada en la
// conexión no hay selector.
// Depende de `piezasBarra` y de `useBarraConsola`, que llevan lo común con la de Redis.
// =============================================================================

import type { DbConnection } from '../../../../../shared/db-ipc'
import { etiquetaAcorde, etiquetasAcorde } from '../../../util/atajos'
import { IconoDetener, IconoEjecutar, IconoEjecutarTodo } from '../iconosBd'
import { IconoHistorial } from '../../../comun/iconosMenu'
import type { EnCurso } from './consolaComun'
import { BotonBase, BotonCandado, BotonIcono, IdentidadBarra } from './piezasBarra'
import { SelectorBaseDocs } from './SelectorBaseDocs'
import { useBarraConsola, type DatosBarraConsola } from './useBarraConsola'
import { txConsolaDocs } from './textosConsolaDocs'

interface PropsBarraConsolaDocs {
  conexion: DbConnection
  base: string | null
  altoFila: number
  conSelectorBase: boolean
  enCurso: EnCurso | null
  detenible: boolean
  cargado: boolean
  textoEstado: string | null
  onEjecutar: () => void
  onEjecutarTodo: () => void
  onDetener: () => void
  onElegirBase: (base: string) => void
  onEditarConexion: () => void
  /** Abre o cierra el popover del historial (lo pinta el pane). */
  onHistorial: () => void
  historialAbierto: boolean
}

function BotonesEjecucion({ p, b }: { p: PropsBarraConsolaDocs; b: DatosBarraConsola }): React.JSX.Element {
  const t = txConsolaDocs()
  return (
    <>
      <BotonIcono
        className="db-consola-run"
        titulo={t.ejecutarSentencia(etiquetaAcorde('ejecutar'))}
        etiqueta={t.ejecutar}
        habilitado={b.puedeEjecutar}
        motivo={b.motivoEjecutar}
        onClick={p.onEjecutar}
      >
        <IconoEjecutar />
      </BotonIcono>
      <BotonIcono
        className="db-consola-run-todo"
        titulo={t.ejecutarTodoTitulo(etiquetasAcorde('ejecutarTodo'))}
        etiqueta={t.ejecutarTodo}
        habilitado={b.puedeEjecutar}
        motivo={b.motivoEjecutar}
        onClick={p.onEjecutarTodo}
      >
        <IconoEjecutarTodo />
      </BotonIcono>
      <BotonIcono
        className="db-consola-detener"
        titulo={t.detenerTitulo(etiquetaAcorde('detener'))}
        etiqueta={t.detener}
        habilitado={p.detenible}
        motivo={t.nadaEnEjecucion}
        onClick={p.onDetener}
      >
        <IconoDetener />
      </BotonIcono>
      {/* Un <button> propio por `aria-expanded` y el `mousedown`: sin cortarlo, el «clic fuera»
          del popover abierto lo cerraría y este clic lo volvería a abrir. */}
      <button
        type="button"
        className={`btn btn-icon db-consola-historial-btn${p.historialAbierto ? ' activo' : ''}`}
        title={t.historialTitulo(etiquetaAcorde('historial'))}
        aria-label={t.historial}
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

function AccionesDocs({ p, b }: { p: PropsBarraConsolaDocs; b: DatosBarraConsola }): React.JSX.Element {
  const t = txConsolaDocs()
  const tituloBase = b.corriendo ? t.esperaParaCambiarBase : p.base ? t.baseCambiar(p.base) : t.baseElegir
  return (
    <div className="panel-actions">
      <BotonesEjecucion p={p} b={b} />
      {p.conSelectorBase && (
        <>
          <span className="panel-actions-sep" aria-hidden="true" />
          <BotonBase
            corriendo={b.corriendo}
            titulo={tituloBase}
            etiqueta={p.base ? t.baseDeLaConsolaN(p.base) : t.baseDeLaConsola}
            abierto={b.ancla !== null}
            botonRef={b.botonBaseRef}
            onAbrir={b.abrirBase}
          />
        </>
      )}
      {p.conexion.readonly && <BotonCandado onEditarConexion={p.onEditarConexion} />}
    </div>
  )
}

/** La barra de la consola de MongoDB, con el selector de base anclado a su botón. */
export function BarraConsolaDocs(p: PropsBarraConsolaDocs): React.JSX.Element {
  const b = useBarraConsola(p.enCurso, p.cargado, p.textoEstado)
  const t = txConsolaDocs()
  const produccion = p.conexion.entorno === 'produccion'
  return (
    <div className={`panel-header db-consola-barra${produccion ? ' db-consola-barra-produccion' : ''}`}>
      <IdentidadBarra conexion={p.conexion} estado={b.estado} anunciado={b.anunciado}>
        <span
          className="db-consola-dato db-consola-esquema"
          title={p.base ? t.baseActual(p.base) : t.sinBaseTitulo}
        >
          {p.base ?? t.sinBase}
        </span>
      </IdentidadBarra>
      <AccionesDocs p={p} b={b} />
      {b.ancla && (
        <SelectorBaseDocs
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
