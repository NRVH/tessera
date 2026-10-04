// =============================================================================
// SalidaConsola: la pestaña fija «Salida» de la consola SQL. Una línea por cosa que
// pasó (el eco de la sentencia, «40 filas en 671 ms», un error, «Lote detenido»), con
// la hora, el enlace «ir a la posición» y las acciones que ofrece. Los textos y qué es
// anidado salen de `consola/salidaConsola.ts`; aquí solo se pintan, con
// autodesplazamiento salvo que el usuario haya subido a leer.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import { useLayoutEffect, useRef } from 'react'
import {
  pegadoAlFondo,
  sigueAlFondo,
  type AccionSalida,
  type EntradaSalida,
  type IrAPosicion,
  type SalidaConsola as DatosSalida
} from './consola/salidaConsola'
import { etiquetaAcorde } from '../../util/atajos'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { IconoConsola } from './iconosBd'

export interface SalidaConsolaProps {
  salida: DatosSalida
  /** Lote con marcas en el editor: solo sus «ir a la posición» son enlaces. */
  loteMarcado: number | null
  /** Lote actual de la consola: solo sus «Ejecutar las N restantes» se ofrecen. */
  loteActual: number | null
  visible: boolean
  onIrA: (ir: IrAPosicion) => void
  onAccion: (a: AccionSalida) => void
}

/**
 * Una línea de la Salida. Enlaces y acciones son botones de verdad; el «ir a la
 * posición» de un lote sin marcas en el editor queda como texto apagado.
 */
function FilaSalida({
  e,
  loteMarcado,
  loteActual,
  onIrA,
  onAccion
}: { e: EntradaSalida } & Omit<SalidaConsolaProps, 'salida' | 'visible'>): React.JSX.Element {
  const ir = e.ir
  const accion = e.accion
  const accionViva = accion !== undefined && (accion.tipo === 'forzar' || accion.loteId === loteActual)
  return (
    <div className={`db-salida-fila db-salida-${e.tipo}${e.anidada ? ' anidada' : ''}`}>
      <span className="db-salida-hora">{e.hora}</span>
      <span className="db-salida-texto">
        {e.texto}
        {ir && ir.etiqueta && (
          <>
            <span className="db-salida-punto"> · </span>
            {ir.loteId === loteMarcado ? (
              <button type="button" className="db-salida-enlace" onClick={() => onIrA(ir)}>
                {ir.etiqueta}
              </button>
            ) : (
              <span className="db-salida-etiqueta-muerta">{ir.etiqueta}</span>
            )}
          </>
        )}
        {accion && accionViva && (
          <>
            <span className="db-salida-punto"> · </span>
            <button type="button" className="db-salida-accion" onClick={() => onAccion(accion)}>
              {accion.etiqueta}
            </button>
          </>
        )}
      </span>
    </div>
  )
}

/** La pestaña «Salida» de una consola: el registro de lo que pasó, o su estado vacío. */
export function SalidaConsola({
  salida,
  loteMarcado,
  loteActual,
  visible,
  onIrA,
  onAccion
}: SalidaConsolaProps): React.JSX.Element {
  const listaRef = useRef<HTMLDivElement>(null)
  const pegadoRef = useRef(true)
  const entradas = salida.entradas

  useLayoutEffect(() => {
    pegadoRef.current = sigueAlFondo(pegadoRef.current, entradas.length)
    const el = listaRef.current
    if (!el || !visible || !pegadoRef.current) return
    el.scrollTop = el.scrollHeight
  }, [entradas, visible])

  if (entradas.length === 0) {
    return (
      <EstadoVacio
        className="db-salida-vacia"
        icono={<IconoConsola />}
        titulo="Sin salida"
        pista={`${etiquetaAcorde('ejecutar')} ejecuta la sentencia del cursor; ${etiquetaAcorde('ejecutarTodo')}, todas; ${etiquetaAcorde('explicar')}, su plan sin ejecutarla.`}
      />
    )
  }

  return (
    // `role="log"`: los lectores anuncian las líneas nuevas sin robar el foco.
    <div
      ref={listaRef}
      className="db-salida"
      role="log"
      aria-live="polite"
      aria-label="Salida de la consola"
      tabIndex={0}
      onScroll={(e) => {
        pegadoRef.current = pegadoAlFondo(e.currentTarget)
      }}
    >
      {entradas.map((e) => (
        <FilaSalida
          key={e.id}
          e={e}
          loteMarcado={loteMarcado}
          loteActual={loteActual}
          onIrA={onIrA}
          onAccion={onAccion}
        />
      ))}
    </div>
  )
}
