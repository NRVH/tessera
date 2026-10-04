// =============================================================================
// Pintado de la rejilla de datos, pieza a pieza y sin envoltorios nuevos: el lienzo
// (cabecera sticky, filas de la ventana, editor de celda), el vacío, la píldora de
// filas y, por PORTAL sobre <body>, el menú contextual y el visor de valor (dentro de
// una fila con `transform`, un `fixed` sería relativo a esa fila).
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { createPortal } from 'react-dom'
import type { DbCelda } from '../../../../../shared/db-explorador-ipc'
import { ContextMenu } from '../../../comun/ContextMenu'
import { EstadoVacio } from '../../../comun/EstadoVacio'
import { EditorCelda } from '../EditorCelda'
import { PildoraFilas } from '../PildoraFilas'
import { VisorValor } from '../VisorValor'
import { posicionEnVista, valorVisto } from './cambiosRejilla'
import { cabecerasRejilla } from './RejillaCabecera'
import { FilaRejilla } from './RejillaFila'
import { itemsMenuRejilla } from './RejillaMenu'
import { cerrarEditor, confirmarEditor, enviarDesdeEditor, nuloDesdeEditor, refEn } from './rejillaAcciones'
import { rango, todo, type Celda } from './seleccionRejilla'
import type { Rejilla } from './rejillaTipos'

/** Última columna y última fila (exclusivas) de la ventana que existen. */
function limites(r: Rejilla): { c1: number; fFin: number } {
  return { c1: Math.min(r.ven.c1, r.numCols), fFin: Math.min(r.ven.f1, r.numFilas) }
}

/** El id de la celda activa si se está pintando (para `aria-activedescendant`). */
export function idActivoDe(r: Rejilla): string | undefined {
  const { c1, fFin } = limites(r)
  const foco = r.sel?.foco ?? null
  const { ven } = r
  return foco && foco.f >= ven.f0 && foco.f < fFin && foco.c >= ven.c0 && foco.c < c1
    ? `${r.idBase}-${foco.f}-${foco.c}`
    : undefined
}

/** Lo que es igual para todas las filas de un render. */
interface ComunFilas {
  c1: number
  rg: ReturnType<typeof rango>
  foco: Celda | null
  posError: number | null
  mensajeError: string | undefined
}

function filaDe(r: Rejilla, f: number, x: ComunFilas): React.JSX.Element {
  const { cambios, k, ven, edicion } = r
  const { rg } = x
  const enSel = rg !== null && f >= rg.f0 && f <= rg.f1
  const nueva = f < k ? cambios.nuevas[f] : undefined
  const editada = nueva ? undefined : cambios.editadas.get(f - k)
  return (
    <FilaRejilla
      key={f}
      f={f}
      fila={r.filas[f]}
      columnas={r.props.columnas}
      recortesFila={r.recortes.get(f)}
      c0={ven.c0}
      c1={x.c1}
      pref={r.pref}
      anchoFijo={r.anchoFijo}
      anchoLienzo={r.anchoLienzo}
      altoFila={r.props.altoFila}
      selC0={enSel ? rg.c0 : -1}
      selC1={enSel ? rg.c1 : -1}
      focoC={x.foco && x.foco.f === f ? x.foco.c : -1}
      idBase={r.idBase}
      numero={nueva ? null : f - k + 1}
      enEdicion={edicion !== null}
      motivos={edicion?.motivosColumna}
      editada={editada}
      nueva={nueva}
      original={editada && editada.valores.size > 0 ? r.filasServidor[f - k] : undefined}
      error={x.posError === f ? x.mensajeError : undefined}
    />
  )
}

function filasRejilla(r: Rejilla): React.JSX.Element[] {
  const { c1, fFin } = limites(r)
  const filaError = r.edicion?.filaError ?? null
  const comun: ComunFilas = {
    c1,
    rg: rango(r.sel),
    foco: r.sel?.foco ?? null,
    posError: filaError ? posicionEnVista(r.cambios, filaError.ref, r.numServidor) : null,
    mensajeError: filaError?.mensaje
  }
  const out: React.JSX.Element[] = []
  for (let f = r.ven.f0; f < fFin; f++) out.push(filaDe(r, f, comun))
  return out
}

/** El editor, sobre su celda (si su fila sigue existiendo). */
function editorRejilla(r: Rejilla): React.JSX.Element | null {
  const { editor } = r
  if (!editor || !r.edicion) return null
  const d = posicionEnVista(r.cambios, editor.ref, r.numServidor)
  const col = r.props.columnas[editor.c]
  if (d === null || !col) return null
  return (
    <EditorCelda
      key={editor.token}
      left={r.anchoFijo + r.pref[editor.c]}
      top={d * r.props.altoFila}
      ancho={r.pref[editor.c + 1] - r.pref[editor.c]}
      altoFila={r.props.altoFila}
      valorInicial={editor.valorInicial}
      sucio={editor.sucio}
      seleccionar={editor.seleccionar}
      placeholder={editor.placeholder}
      alDerecha={col.tipoLogico === 'numero'}
      etiqueta={`Editar ${col.nombre}`}
      onConfirmar={(texto, cambiado, mov, perdioFoco) => confirmarEditor(r, texto, cambiado, mov, perdioFoco)}
      onCancelar={() => {
        cerrarEditor(r)
      }}
      onNulo={() => nuloDesdeEditor(r)}
      onEnviar={(texto, cambiado) => enviarDesdeEditor(r, texto, cambiado)}
    />
  )
}

function cabeceraRejilla(r: Rejilla): React.JSX.Element | false {
  const { numFilas, numCols, altoCab } = r
  return (
    numCols > 0 && (
      <div ref={r.cabRef} className="db-rejilla-cab" role="row" aria-rowindex={1} style={{ height: altoCab }}>
        <div
          className="db-rejilla-esquina"
          role="columnheader"
          aria-colindex={1}
          aria-label="Número de fila"
          style={{ width: r.anchoFijo }}
          title="Seleccionar todo lo cargado"
          onClick={() => {
            r.setSel(todo({ filas: numFilas, columnas: numCols }))
            r.raizRef.current?.focus({ preventScroll: true })
          }}
        />
        {cabecerasRejilla(r, limites(r).c1)}
      </div>
    )
  )
}

/** El lienzo del tamaño total: cabecera, filas de la ventana, «cargando» y editor. */
export function lienzoRejilla(r: Rejilla): React.JSX.Element {
  const { numFilas, numCols, altoCab, anchoLienzo } = r
  const { altoFila, cargandoMas } = r.props
  const filaCarga = cargandoMas && (r.props.datos?.hayMas ?? false)
  const altoCuerpo = numFilas * altoFila + (filaCarga ? altoFila : 0)
  return (
    <div className="db-rejilla-lienzo" style={{ width: anchoLienzo, height: (numCols > 0 ? altoCab : 0) + altoCuerpo }}>
      {cabeceraRejilla(r)}
      {/* Siempre montado, aunque no haya columnas: de él se mide la letra de las
          celdas, y medir antes del primer resultado ahorra un reflujo. */}
      <div ref={r.cuerpoRef} className="db-rejilla-cuerpo" style={{ height: altoCuerpo }}>
        {filasRejilla(r)}
        {filaCarga && (
          <div
            className="db-rejilla-cargando"
            style={{ transform: `translateY(${numFilas * altoFila}px)`, height: altoFila, width: anchoLienzo }}
          >
            <span className="db-rejilla-cargando-texto">Cargando más filas…</span>
          </div>
        )}
        {editorRejilla(r)}
      </div>
    </div>
  )
}

export function vaciaRejilla(r: Rejilla): React.JSX.Element | false {
  const vacia = r.props.datos !== null && r.numFilas === 0 && r.numCols > 0
  return (
    vacia && (
      <div className="db-rejilla-vacia" style={{ top: r.altoCab }}>
        <EstadoVacio titulo="Sin filas" pista="La consulta no devolvió ninguna fila." />
      </div>
    )
  )
}

export function pildoraRejilla(r: Rejilla): React.JSX.Element | false {
  const p = r.props
  return (
    p.datos !== null && (
      <PildoraFilas
        cargadas={r.numServidor}
        hayMas={p.datos?.hayMas ?? false}
        total={p.total}
        contando={p.contando}
        onContar={p.onContar}
        sinOrdenEstable={p.sinOrdenEstable}
        sinLector={p.sinLector}
        onVolverAEjecutar={p.onVolverAEjecutar}
        onTraerTodas={p.onTraerTodas}
        trayendoTodas={p.trayendoTodas ?? false}
        onDetenerTraerTodas={p.onDetenerTraerTodas}
        exportando={p.exportando ?? null}
        onCancelarExportacion={p.onCancelarExportacion}
      />
    )
  )
}

/** `key` por paso: el segundo paso MONTA otro menú, que enfoca su primera opción. */
export function menuRejilla(r: Rejilla, cerrarMenu: () => void): React.ReactPortal | null {
  const { menu } = r
  if (!menu) return null
  return createPortal(
    <ContextMenu key={menu.paso} x={menu.x} y={menu.y} items={itemsMenuRejilla(r)} onClose={cerrarMenu} />,
    document.body
  )
}

/** El visor de valor sobre la celda activa; el valor completo solo de una celda del servidor sin cambios. */
export function visorRejilla(r: Rejilla, cerrarVisor: () => void): React.ReactPortal | null {
  const { visor, numFilas, numCols, filas } = r
  const celdaVisor = visor && visor.f < numFilas && visor.c < numCols ? visor : null
  if (!celdaVisor) return null
  const celdaEn = (c: Celda): DbCelda => {
    const fila = filas[c.f]
    return fila && c.c < fila.length ? fila[c.c] : null
  }
  const refVisor = refEn(r, celdaVisor.f)
  const visorDelServidor =
    refVisor !== null &&
    refVisor.tipo === 'servidor' &&
    !valorVisto(r.cambios, refVisor, celdaVisor.c, r.filasServidor).cambiada
  const filaVisor = refVisor && refVisor.tipo === 'servidor' ? refVisor.f : -1
  const { onValorCompleto, razonSinValorCompleto } = r.props
  return createPortal(
    <VisorValor
      key={`${celdaVisor.f}-${celdaVisor.c}`}
      columna={r.props.columnas[celdaVisor.c]}
      valor={celdaEn(celdaVisor)}
      longitudOriginal={visorDelServidor ? r.recortes.get(celdaVisor.f)?.get(celdaVisor.c) : undefined}
      cargarCompleto={onValorCompleto && visorDelServidor ? () => onValorCompleto(filaVisor, celdaVisor.c) : undefined}
      razonSinValorCompleto={razonSinValorCompleto}
      onCerrar={cerrarVisor}
    />,
    document.body
  )
}
