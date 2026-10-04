// =============================================================================
// El registro de la consola de Redis: la tira de resultados de las otras consolas con UNA
// pestaña, «Salida», y dentro una sesión de comandos: el eco de cada uno con sus ms a la
// derecha y su respuesta debajo, y las notas sueltas. Toma el CSS de la Salida (`db-salida-*`)
// y añade el suyo en `consolaClaves.css`. Se autodesplaza salvo que el usuario haya subido a
// leer, y no virtualiza: los topes de `consolaClaves.ts` lo acotan.
// Decisiones: docs/decisiones/bd/ui-claves-comandos-y-registro.md
// =============================================================================

import { useLayoutEffect, useRef } from 'react'
import { etiquetaAcorde } from '../../../util/atajos'
import { EstadoVacio } from '../../../comun/EstadoVacio'
import { pegadoAlFondo, sigueAlFondo, type AccionSalida, type IrAPosicion } from '../consola/salidaConsola'
import { IconoLimpiar } from '../iconosBd'
import { textoMs, type EntradaRegistro, type RegistroConsola } from './consolaClaves'

type Entrada = RegistroConsola['entradas'][number]

function EnlaceIr({ ir, loteMarcado, onIrA }: { ir: IrAPosicion; loteMarcado: number | null; onIrA: (ir: IrAPosicion) => void }): React.JSX.Element {
  return (
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
  )
}

function NotaRegistro({ e, onAccion }: { e: Extract<Entrada, { tipo: 'nota' }>; onAccion: (a: AccionSalida) => void }): React.JSX.Element {
  const accion = e.accion
  return (
    <div className={`db-salida-fila kv-tono-${e.tono}`}>
      <span className="db-salida-hora">{e.hora}</span>
      <span className="db-salida-texto">
        {e.texto}
        {accion && (
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

function ComandoRegistro({
  e,
  loteMarcado,
  onIrA
}: {
  e: Exclude<Entrada, { tipo: 'nota' }>
  loteMarcado: number | null
  onIrA: (ir: IrAPosicion) => void
}): React.JSX.Element {
  const ultima = e.lineas.length - 1
  return (
    <div className={`kv-comando kv-estado-${e.estado}`}>
      <div className="db-salida-fila db-salida-eco">
        <span className="db-salida-hora">{e.hora}</span>
        <span className="db-salida-texto">{e.eco}</span>
        <span className="kv-registro-ms">{e.estado === 'corriendo' ? '…' : textoMs(e.ms)}</span>
      </div>
      {e.lineas.map((l, k) => (
        <div key={k} className={`db-salida-fila anidada kv-tono-${l.tono}`}>
          <span className="db-salida-hora">{e.hora}</span>
          <span className="db-salida-texto">
            {l.texto}
            {k === ultima && e.ir && e.ir.etiqueta ? <EnlaceIr ir={e.ir} loteMarcado={loteMarcado} onIrA={onIrA} /> : null}
          </span>
        </div>
      ))}
    </div>
  )
}

interface PropsRegistroClaves {
  alto: number
  visible: boolean
  registro: RegistroConsola
  loteMarcado: number | null
  onIrA: (ir: IrAPosicion) => void
  onAccion: (a: AccionSalida) => void
  onLimpiar: () => void
}

function CabeceraRegistro({ vacio, onLimpiar }: { vacio: boolean; onLimpiar: () => void }): React.JSX.Element {
  return (
    <div className="db-resultados-cabecera">
      <div className="db-resultados-tabs" role="tablist" aria-label="Salida">
        <div className="terminal-tab db-resultado-tab active" role="tab" aria-selected tabIndex={0} title="Salida: cada comando con su respuesta">
          <span className="terminal-tab-name">Salida</span>
        </div>
      </div>
      <div className="panel-actions">
        <span className="btn-envoltura" title={vacio ? 'La salida ya está vacía' : 'Limpiar la salida'}>
          <button type="button" className="btn btn-icon" aria-label="Limpiar la salida" disabled={vacio} onClick={onLimpiar}>
            <IconoLimpiar />
          </button>
        </span>
      </div>
    </div>
  )
}

/** Autodesplazamiento al final salvo que el usuario haya subido a leer; vive en el registro, no en la lista, que se desmonta al vaciarse. */
function useAutodesplazamiento(
  visible: boolean,
  entradas: readonly EntradaRegistro[]
): { listaRef: React.RefObject<HTMLDivElement>; alDesplazar: (e: React.UIEvent<HTMLDivElement>) => void } {
  const listaRef = useRef<HTMLDivElement>(null)
  const pegadoRef = useRef(true)
  useLayoutEffect(() => {
    pegadoRef.current = sigueAlFondo(pegadoRef.current, entradas.length)
    const el = listaRef.current
    if (!el || !visible || !pegadoRef.current) return
    el.scrollTop = el.scrollHeight
  }, [entradas, visible])
  const alDesplazar = (e: React.UIEvent<HTMLDivElement>): void => {
    pegadoRef.current = pegadoAlFondo(e.currentTarget)
  }
  return { listaRef, alDesplazar }
}

function ListaRegistro({
  p,
  entradas,
  desplazamiento
}: {
  p: PropsRegistroClaves
  entradas: readonly EntradaRegistro[]
  desplazamiento: ReturnType<typeof useAutodesplazamiento>
}): React.JSX.Element {
  return (
    <div
      ref={desplazamiento.listaRef}
      className="db-salida kv-registro"
      role="log"
      aria-live="polite"
      aria-label="Salida de la consola"
      tabIndex={0}
      onScroll={desplazamiento.alDesplazar}
    >
      {entradas.map((e) =>
        e.tipo === 'nota' ? (
          <NotaRegistro key={e.id} e={e} onAccion={p.onAccion} />
        ) : (
          <ComandoRegistro key={e.id} e={e} loteMarcado={p.loteMarcado} onIrA={p.onIrA} />
        )
      )}
    </div>
  )
}

/** La tira de resultados de la consola de Redis: un registro con el eco y la respuesta de cada comando. */
export function RegistroClaves(p: PropsRegistroClaves): React.JSX.Element {
  const entradas = p.registro.entradas
  const desplazamiento = useAutodesplazamiento(p.visible, entradas)
  return (
    <section className="db-consola-resultados" style={{ height: p.alto }} aria-label="Resultados de la consola">
      <CabeceraRegistro vacio={entradas.length === 0} onLimpiar={p.onLimpiar} />
      <div className="db-resultados-cuerpo">
        <div className="db-resultados-panel">
          {entradas.length === 0 ? (
            <EstadoVacio
              className="db-salida-vacia"
              titulo="Sin salida"
              pista={`${etiquetaAcorde('ejecutar')} ejecuta el comando de la línea del cursor o las líneas seleccionadas; ${etiquetaAcorde('ejecutarTodo')}, todos. Un comando por línea; las que empiezan por # son comentarios.`}
            />
          ) : (
            <ListaRegistro p={p} entradas={entradas} desplazamiento={desplazamiento} />
          )}
        </div>
      </div>
    </section>
  )
}
