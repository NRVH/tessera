// =============================================================================
// Acciones de la rejilla de datos sobre el contexto de un render (`Rejilla`): mostrar
// una celda, copiar, abrir el visor y editar (editor de celda, NULL, revertir, borrar
// y añadir filas). Lo pendiente es del dueño: aquí solo se le pasa el siguiente estado
// (`onCambios`), calculado con las funciones puras de `cambiosRejilla.ts`.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import type { DbCelda } from '../../../../../shared/db-explorador-ipc'
import { notify, notifyError } from '../../../comun/notifications'
import type { MovEditor } from '../EditorCelda'
import {
  anadirFila,
  borrarFilas,
  editarCelda,
  editarCeldas,
  filaEnVista,
  filasEnRango,
  motivoCeldaNoEditable,
  posicionEnVista,
  reubicarCelda,
  revertirRango,
  textoParaEditar,
  valorVisto,
  type CambiosRejilla,
  type EdicionCelda,
  type RefFila,
  type VistaFilas
} from './cambiosRejilla'
import { formatoEntero } from './celdasRejilla'
import { copiarComo, type FormatoCopia } from './copiarComo'
import { mover, rango, type Celda, type Seleccion } from './seleccionRejilla'
import { desplazarParaMostrar } from './ventanaRejilla'
import type { Rejilla } from './rejillaTipos'

type Rango = { f0: number; f1: number; c0: number; c1: number }

/** Desplaza lo justo para que la celda se vea. */
export function mostrarCelda(r: Rejilla, celda: Celda): void {
  const el = r.scrollRef.current
  if (!el) return
  const d = desplazarParaMostrar(celda, {
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
    alto: el.clientHeight,
    ancho: el.clientWidth,
    altoFila: r.props.altoFila,
    pref: r.pref,
    anchoFijo: r.anchoFijo,
    altoFijo: r.altoCab
  })
  if (d.scrollTop !== undefined) el.scrollTop = d.scrollTop
  if (d.scrollLeft !== undefined) el.scrollLeft = d.scrollLeft
}

/** Copia la selección por el portapapeles de Tessera; avisa si había valores recortados. */
export function copiar(r: Rejilla, formato: FormatoCopia): void {
  const rg = rango(r.sel)
  if (!rg || r.numFilas === 0 || r.numCols === 0) return
  const { columnas, motor, tablaInsert } = r.props
  const copia = copiarComo(formato, { columnas, filas: r.filas, rango: rg, recortes: r.recortes, motor, tablaInsert })
  window.tessera.clipboard
    .write(copia.texto)
    .then(() => {
      if (copia.incompletas > 0) {
        notify(
          'warn',
          'Copiado con valores recortados',
          `${formatoEntero(copia.incompletas)} ${
            copia.incompletas === 1 ? 'celda llegó recortada' : 'celdas llegaron recortadas'
          } del servidor: lo copiado no es el valor entero.`
        )
      }
    })
    .catch((err: unknown) => notifyError('No se pudo copiar', err))
}

function fueraDeVista(r: Rejilla, celda: Celda): boolean {
  return celda.f < 0 || celda.f >= r.numFilas || celda.c < 0 || celda.c >= r.numCols
}

export function abrirVisor(r: Rejilla, celda: Celda): void {
  if (fueraDeVista(r, celda)) return
  r.setMenu(null)
  mostrarCelda(r, celda)
  r.setVisor(celda)
}

export function refEn(r: Rejilla, d: number): RefFila | null {
  return filaEnVista(r.cambios, d, r.numServidor)
}

function recortadaEn(r: Rejilla, ref: RefFila, c: number): boolean {
  return ref.tipo === 'servidor' && r.props.datos?.recortes.get(ref.f)?.has(c) === true
}

/** Por qué no se puede editar la celda, o null. */
export function motivoEn(r: Rejilla, celda: Celda): string | null {
  const ed = r.propsRef.current.edicion
  if (!ed) return 'Esta rejilla es de solo lectura.'
  const ref = refEn(r, celda.f)
  if (!ref) return 'La fila ya no está.'
  return motivoCeldaNoEditable(ed.cambios, ref, ed.motivosColumna[celda.c] ?? null, recortadaEn(r, ref, celda.c))
}

function avisarNoEditable(motivo: string): void {
  notify('info', 'Esta celda no se puede editar', motivo)
}

function aplicarCambios(r: Rejilla, siguiente: CambiosRejilla): void {
  const ed = r.propsRef.current.edicion
  if (ed && siguiente !== ed.cambios) ed.onCambios(siguiente)
}

function originalEn(r: Rejilla, ref: RefFila, c: number): DbCelda | undefined {
  return ref.tipo === 'servidor' ? r.filasServidor[ref.f]?.[c] : undefined
}

/** Abre el editor sobre la celda (o avisa de por qué no, si `avisar`). */
export function abrirEditor(r: Rejilla, celda: Celda, modo: 'editar' | 'vaciar' | { texto: string }, avisar: boolean): void {
  if (fueraDeVista(r, celda)) return
  const motivo = motivoEn(r, celda)
  if (motivo) {
    if (avisar) avisarNoEditable(motivo)
    return
  }
  const ref = refEn(r, celda.f)
  if (!ref) return
  r.setMenu(null)
  mostrarCelda(r, celda)
  const visto = valorVisto(r.cambios, ref, celda.c, r.filasServidor)
  const inicial = modo === 'editar' ? textoParaEditar(visto.valor) : modo === 'vaciar' ? '' : modo.texto
  r.setEditor({
    ref,
    c: celda.c,
    valorInicial: inicial,
    sucio: modo !== 'editar',
    seleccionar: modo === 'editar',
    placeholder: visto.porDefecto ? 'DEFAULT' : visto.valor === null ? 'NULL' : undefined,
    token: ++r.tokenEditorRef.current
  })
}

/** Mueve la celda activa tras confirmar (Intro baja, Tab avanza…), sin extender. */
function moverTras(r: Rejilla, desde: Celda, mov: MovEditor): void {
  if (mov === 'quieto') return
  const base: Seleccion = { ancla: desde, foco: desde }
  const n = mover(base, mov, { filas: r.numFilas, columnas: r.numCols }, false)
  r.setSel(n)
  if (n) r.pendienteMostrarRef.current = n.foco
}

/** Cierra el editor y devuelve la celda en la que estaba (si su fila sigue). */
export function cerrarEditor(r: Rejilla, devolverFoco = true): Celda | null {
  const e = r.editor
  r.setEditor(null)
  if (devolverFoco) r.raizRef.current?.focus({ preventScroll: true })
  if (!e) return null
  const d = posicionEnVista(r.cambios, e.ref, r.numServidor)
  return d === null ? null : { f: d, c: e.c }
}

function escribirEditor(r: Rejilla, texto: string, cambiado: boolean): void {
  const e = r.editor
  const ed = r.propsRef.current.edicion
  if (!e || !ed || !cambiado) return
  aplicarCambios(r, editarCelda(ed.cambios, e.ref, e.c, texto, originalEn(r, e.ref, e.c)))
}

/** Confirma el editor; si el foco se fue (`perdioFoco`), se queda donde lo llevó el usuario. */
export function confirmarEditor(r: Rejilla, texto: string, cambiado: boolean, mov: MovEditor, perdioFoco = false): void {
  escribirEditor(r, texto, cambiado)
  const celda = cerrarEditor(r, !perdioFoco)
  if (celda) moverTras(r, celda, mov)
}

function avisarSaltadas(rg: Rango, saltadas: number, primerMotivo: string | null): void {
  if (saltadas === 0 || !primerMotivo) return
  const total = (rg.f1 - rg.f0 + 1) * (rg.c1 - rg.c0 + 1)
  if (saltadas === total) avisarNoEditable(primerMotivo)
  else {
    notify(
      'info',
      `${formatoEntero(saltadas)} ${saltadas === 1 ? 'celda se quedó' : 'celdas se quedaron'} como estaban`,
      primerMotivo
    )
  }
}

/** Pone NULL en las celdas editables del rango, en UNA operación (`editarCeldas`). */
export function ponerNulo(r: Rejilla, rg: Rango): void {
  const ed = r.propsRef.current.edicion
  if (!ed) return
  let saltadas = 0
  let primerMotivo: string | null = null
  const lista: EdicionCelda[] = []
  for (let d = rg.f0; d <= rg.f1; d++) {
    const ref = refEn(r, d)
    if (!ref) continue
    for (let c = rg.c0; c <= rg.c1; c++) {
      const motivo = motivoCeldaNoEditable(ed.cambios, ref, ed.motivosColumna[c] ?? null, recortadaEn(r, ref, c))
      if (motivo) {
        saltadas++
        if (primerMotivo === null) primerMotivo = motivo
        continue
      }
      lista.push({ ref, col: c, valor: null, original: originalEn(r, ref, c) })
    }
  }
  aplicarCambios(r, editarCeldas(ed.cambios, lista))
  avisarSaltadas(rg, saltadas, primerMotivo)
}

export function nuloDesdeEditor(r: Rejilla): void {
  const e = r.editor
  const ed = r.propsRef.current.edicion
  if (e && ed) aplicarCambios(r, editarCelda(ed.cambios, e.ref, e.c, null, originalEn(r, e.ref, e.c)))
  cerrarEditor(r)
}

export function enviarDesdeEditor(r: Rejilla, texto: string, cambiado: boolean): void {
  escribirEditor(r, texto, cambiado)
  cerrarEditor(r)
  // El cambio recién escrito llega al dueño en este mismo lote de React: «Enviar» tiene
  // que verlo, así que se pide en el siguiente fotograma.
  const propsRef = r.propsRef
  requestAnimationFrame(() => propsRef.current.edicion?.onEnviar())
}

export function refsDelRango(r: Rejilla, rg: { f0: number; f1: number }): RefFila[] {
  return filasEnRango(r.cambios, rg.f0, rg.f1, r.numServidor)
}

export function borrarSeleccion(r: Rejilla): void {
  const rg = rango(r.sel)
  const ed = r.propsRef.current.edicion
  if (!rg || !ed) return
  aplicarCambios(r, borrarFilas(ed.cambios, refsDelRango(r, rg)))
}

export function revertirSeleccion(r: Rejilla): void {
  const rg = rango(r.sel)
  const ed = r.propsRef.current.edicion
  if (!rg || !ed) return
  aplicarCambios(r, revertirRango(ed.cambios, refsDelRango(r, rg), rg.c0, rg.c1, r.numCols))
}

/** Añade una fila nueva arriba y deja la celda activa en su primera columna editable. */
export function anadir(r: Rejilla): void {
  const ed = r.propsRef.current.edicion
  if (!ed) return
  const { cambios: c2, id } = anadirFila(ed.cambios)
  aplicarCambios(r, c2)
  const d = posicionEnVista(c2, { tipo: 'nueva', id }, r.numServidor) ?? 0
  let c = ed.motivosColumna.findIndex((m) => m === null)
  if (c < 0) c = 0
  const celda = { f: d, c }
  r.setSel({ ancla: celda, foco: celda })
  // Esta selección ya está en la vista NUEVA (la de `c2`): que el reubicador no la mueva.
  // El visor sigue en la vieja: se lleva a la nueva por identidad, como hace el reubicador.
  const antes = r.vistaSelRef.current
  const despues: VistaFilas = { cambios: c2, numServidor: r.numServidor }
  r.setVisor((v) => reubicarCelda(v, antes, despues))
  r.vistaSelRef.current = despues
  r.pendienteMostrarRef.current = celda
  r.raizRef.current?.focus({ preventScroll: true })
}
