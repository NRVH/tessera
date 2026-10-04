// =============================================================================
// Los botones de icono de la barra de la consola SQL (la mitad derecha), agrupados por
// función con un filete: ejecutar, plan e historial, esquema, transacción y el candado.
// Un botón deshabilitado va dentro de `.btn-envoltura`, que lleva el `title` con su
// motivo; los acordes del `title` salen de `etiquetaAcorde` con la plataforma real.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import type { RefObject } from 'react'
import type { DbConnection } from '../../../../../shared/db-ipc'
import { etiquetaAcorde, etiquetasAcorde } from '../../../util/atajos'
import { IconoHistorial } from '../../../comun/iconosMenu'
import { BotonCandado, BotonIcono } from '../documentos/piezasBarra'
import {
  IconoCommit,
  IconoDetener,
  IconoEjecutar,
  IconoEjecutarTodo,
  IconoEsquema,
  IconoRollback,
  IconoTx
} from '../iconosBd'
import { IconoPlan } from '../iconosConsola'
import type { NivelSelectorConsola, TextosSelectorConsola } from '../nivelBasesBd'
import type { BarraTx } from './estadoConsola'
import type { Lote } from './lote'

/** Lo que recibe la barra de la consola SQL. */
export interface BarraConsolaProps {
  alias: string
  /** La conexión (el selector de esquema lee su lista de la caché del catálogo). */
  conexion: DbConnection
  altoFila: number
  /** Esquema en que está la consola (`esquemaEfectivo`), o null si no se sabe. */
  esquemaActual: string | null
  /** Lo elegido en el selector; null = el de la conexión. */
  esquemaElegido: string | null
  cambiandoEsquema: boolean
  onElegirEsquema: (esquema: string | null) => void
  barraTx: BarraTx
  lote: Lote | null
  ejecutando: boolean
  /**
   * ■ tiene algo que parar. No es `ejecutando`: una página de «cargar más» o un
   * «Contar» en vuelo también ocupan la sesión, y mientras tanto se puede seguir
   * ejecutando.
   */
  detenible: boolean
  cargado: boolean
  /** Estado cuando no corre nada: «Cargando…», la pista, un error de lectura. */
  textoEstado: string | null
  onEjecutar: () => void
  onEjecutarTodo: () => void
  onDetener: () => void
  onAlternarTx: () => void
  onCommit: () => void
  onRollback: () => void
  onEditarConexion: () => void
  /** El plan de la sentencia del cursor o de la selección. */
  onExplicar: () => void
  /** Abre o cierra el popover del historial (lo pinta el pane). */
  onHistorial: () => void
  historialAbierto: boolean
}

/** El botón del esquema tal como lo calcula la barra. */
export interface EstadoBotonEsquema {
  ref: RefObject<HTMLButtonElement>
  abierto: boolean
  nivel: NivelSelectorConsola
  textos: TextosSelectorConsola
  titulo: string
  puede: boolean
  alPulsar: () => void
}

/** Ejecutar, ejecutar todo y detener. */
function BotonesEjecutar({ p, motivo }: { p: BarraConsolaProps; motivo: string | undefined }): React.JSX.Element {
  return (
    <>
      <BotonIcono
        className="db-consola-run"
        titulo={`Ejecutar la sentencia del cursor o la selección · ${etiquetaAcorde('ejecutar')}`}
        etiqueta="Ejecutar"
        habilitado={motivo === undefined}
        motivo={motivo}
        onClick={p.onEjecutar}
      >
        <IconoEjecutar />
      </BotonIcono>
      <BotonIcono
        className="db-consola-run-todo"
        titulo={`Ejecutar todo · ${etiquetasAcorde('ejecutarTodo').join(' o ')}`}
        etiqueta="Ejecutar todo"
        habilitado={motivo === undefined}
        motivo={motivo}
        onClick={p.onEjecutarTodo}
      >
        <IconoEjecutarTodo />
      </BotonIcono>
      <BotonIcono
        className="db-consola-detener"
        titulo={`Detener · ${etiquetaAcorde('detener')}`}
        etiqueta="Detener"
        habilitado={p.detenible}
        motivo="No hay nada en ejecución"
        onClick={p.onDetener}
      >
        <IconoDetener />
      </BotonIcono>
    </>
  )
}

/** El plan y el historial: son del SQL que se escribe, no de la transacción. */
function BotonesPlan({ p, motivo }: { p: BarraConsolaProps; motivo: string | undefined }): React.JSX.Element {
  return (
    <>
      <BotonIcono
        className="db-consola-explicar"
        titulo={`Explicar el plan de la sentencia del cursor o de la selección (sin ejecutarla) · ${etiquetaAcorde('explicar')}`}
        etiqueta="Explicar plan"
        habilitado={motivo === undefined}
        motivo={motivo}
        onClick={p.onExplicar}
      >
        <IconoPlan />
      </BotonIcono>
      {/* Un <button> propio por `aria-expanded` y el `mousedown`: sin cortarlo, el
          «clic fuera» del popover abierto lo cerraría y este clic lo volvería a abrir. */}
      <button
        type="button"
        className={`btn btn-icon db-consola-historial-btn${p.historialAbierto ? ' activo' : ''}`}
        title={`Historial de consultas · ${etiquetaAcorde('historial')}`}
        aria-label="Historial de consultas"
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

/**
 * El esquema: un <button> propio por su ref (el popover cuelga de él) y
 * `aria-expanded`, con el mismo cromo y la misma envoltura. Con base fija no se pinta.
 */
function BotonEsquema({ p, e }: { p: BarraConsolaProps; e: EstadoBotonEsquema }): React.JSX.Element | null {
  if (e.nivel === 'fija') return null
  if (!e.puede) {
    return (
      <span className="btn-envoltura" title={e.titulo}>
        <button
          type="button"
          className="btn btn-icon db-consola-esquema-btn"
          aria-label={e.textos.etiquetaBoton(p.esquemaActual)}
          disabled
        >
          <IconoEsquema />
        </button>
      </span>
    )
  }
  return (
    <button
      ref={e.ref}
      type="button"
      className={`btn btn-icon db-consola-esquema-btn${e.abierto ? ' activo' : ''}`}
      title={e.titulo}
      aria-label={e.textos.etiquetaBoton(p.esquemaActual)}
      aria-haspopup="dialog"
      aria-expanded={e.abierto}
      // El mousedown no llega a la ventana: si no, el «clic fuera» del selector
      // abierto lo cerraría y este clic lo volvería a abrir.
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={e.alPulsar}
    >
      <IconoEsquema />
    </button>
  )
}

/** Rollback dice su nombre al pasar el ratón, con las clases del botón de reiniciar. */
function BotonRollback({ tx, onRollback }: { tx: BarraTx; onRollback: () => void }): React.JSX.Element {
  if (tx.puedeRollback) {
    return (
      <button
        type="button"
        className="btn btn-icon boton-reinicio db-consola-rollback"
        title={`${tx.tituloRollback} · ${etiquetaAcorde('rollback')}`}
        aria-label="Revertir (Rollback)"
        onClick={onRollback}
      >
        <IconoRollback />
        <span className="boton-reinicio-etiqueta">
          <span>Revertir (Rollback)</span>
        </span>
      </button>
    )
  }
  return (
    <span className="btn-envoltura" title={tx.tituloRollback}>
      <button type="button" className="btn btn-icon boton-reinicio db-consola-rollback" aria-label="Revertir (Rollback)" disabled>
        <IconoRollback />
        <span className="boton-reinicio-etiqueta">
          <span>Revertir (Rollback)</span>
        </span>
      </button>
    </span>
  )
}

/** El modo de transacción (⇄), y COMMIT y ROLLBACK tras su filete. */
function BotonesTx({ p }: { p: BarraConsolaProps }): React.JSX.Element {
  const tx = p.barraTx
  return (
    <>
      <BotonIcono
        className="db-consola-tx-modo"
        titulo={tx.tituloModo}
        etiqueta={`Transacción ${tx.modo === 'auto' ? 'automática' : 'manual'}`}
        habilitado={tx.puedeCambiarModo}
        motivo={tx.tituloModo}
        pulsado={tx.modoPulsado}
        onClick={p.onAlternarTx}
      >
        <IconoTx />
      </BotonIcono>

      <span className="panel-actions-sep" aria-hidden="true" />

      <BotonIcono
        className="db-consola-commit"
        titulo={`${tx.tituloCommit} · ${etiquetaAcorde('commit')}`}
        etiqueta="Confirmar (Commit)"
        habilitado={tx.puedeCommit}
        motivo={tx.tituloCommit}
        onClick={p.onCommit}
      >
        <IconoCommit />
      </BotonIcono>
      <BotonRollback tx={tx} onRollback={p.onRollback} />
    </>
  )
}

/** Los botones de la barra, de izquierda a derecha y con sus filetes. */
export function AccionesBarraConsola({
  p,
  motivo,
  esquema
}: {
  p: BarraConsolaProps
  /** Por qué no se puede ejecutar (ni explicar) ahora; undefined = se puede. */
  motivo: string | undefined
  esquema: EstadoBotonEsquema
}): React.JSX.Element {
  return (
    <div className="panel-actions">
      <BotonesEjecutar p={p} motivo={motivo} />

      <span className="panel-actions-sep" aria-hidden="true" />

      <BotonesPlan p={p} motivo={motivo} />

      <span className="panel-actions-sep" aria-hidden="true" />

      <BotonEsquema p={p} e={esquema} />

      {esquema.nivel !== 'fija' && <span className="panel-actions-sep" aria-hidden="true" />}

      <BotonesTx p={p} />

      {p.conexion.readonly && <BotonCandado onEditarConexion={p.onEditarConexion} />}
    </div>
  )
}
