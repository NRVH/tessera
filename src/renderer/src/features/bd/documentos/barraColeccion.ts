// =============================================================================
// Las acciones de la barra de filtro de la pestaña de colección: aplicar lo escrito, cambiar
// entre la barra guiada y la de texto, ordenar por la cabecera y el texto que abre la
// consola. Son funciones sobre el estado de `useEstadoConsulta`; `DbColeccionPane` las llama.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import { validarFiltro } from '../../../../../shared/filtroGuiado'
import { ciclarOrden } from '../filtro/modeloFiltro'
import { consultaConOrden, consultaJsonAplicada, filtroParaConsola, mismaPeticion, type ConsultaColeccion, type ModoFiltroDocs } from './coleccionDocs'
import type { EstadoConsulta } from './useConsultaColeccion'

type Consultar = (c: ConsultaColeccion) => Promise<void>

/** Aplica lo ESCRITO en la barra que se ve (Intro, «Aplicar» de la guiada, Refrescar). */
export function aplicarEscrito(e: EstadoConsulta, consultar: Consultar): void {
  // Parte de lo PEDIDO: un clic en la cabecera aún en vuelo no se pierde al pulsar Intro.
  const base0 = e.pedidaRef.current
  if (e.modo === 'json') {
    void consultar(consultaJsonAplicada(base0, e.escrito))
    return
  }
  // La guiada se valida ANTES de pedir (el main vuelve a validar): el error va a su fila.
  const problema = validarFiltro(e.guiadoEscrito)
  if (problema) {
    e.setErrorGuiado({ condicion: problema.indice >= 0 ? problema.indice : null, mensaje: problema.mensaje })
    return
  }
  void consultar({ ...base0, modo: 'guiado', guiado: e.guiadoEscrito })
}

/** Intro aplica; Esc vuelve a lo último aplicado si hay algo distinto escrito. */
export function teclaCampo(e: EstadoConsulta, consultar: Consultar, ev: React.KeyboardEvent<HTMLInputElement>): void {
  const ap = e.aplicado.barra
  const { escrito } = e
  if (ev.key === 'Enter') {
    ev.preventDefault()
    aplicarEscrito(e, consultar)
  } else if (ev.key === 'Escape' && (escrito.filtro !== ap.filtro || escrito.proyeccion !== ap.proyeccion || escrito.orden !== ap.orden)) {
    ev.preventDefault()
    ev.stopPropagation()
    e.setEscrito(ap)
  }
}

/** Esc en la barra guiada: vuelve a lo último aplicado que funcionó. */
export function restaurarGuiado(e: EstadoConsulta): void {
  e.setGuiadoEscrito(e.aplicadoRef.current.guiado)
  e.setErrorGuiado(null)
}

/**
 * Cambia de barra. Si lo aplicado del modo nuevo pide otra cosa que lo de ahora, se vuelve
 * a pedir (la tabla dice lo que dice la barra visible); lo ESCRITO de cada modo se queda.
 */
export function cambiarModo(e: EstadoConsulta, consultar: Consultar, nuevo: ModoFiltroDocs): void {
  if (nuevo === e.modo) return
  e.setModo(nuevo)
  e.setErrorGuiado(null)
  e.setErrorCampo(null)
  // Con una consulta en vuelo se vuelve a pedir siempre: si no, su respuesta llegaría con
  // el modo viejo. Sin ninguna, lo pedido ES lo aplicado (un fallo lo devuelve a ello).
  const actual = e.pedidaRef.current
  const siguiente: ConsultaColeccion = { ...actual, modo: nuevo }
  if (e.peticionRef.current === null && mismaPeticion(actual, siguiente)) {
    e.aplicadoRef.current = siguiente
    e.pedidaRef.current = siguiente
    e.setAplicado(siguiente)
  } else {
    void consultar(siguiente)
  }
}

/**
 * El clic en la cabecera (Mayús = añadir): se pide con el filtro ya PEDIDO (no con lo que
 * esté a medio escribir en la barra) y el orden nuevo.
 */
export function ordenarPor(e: EstadoConsulta, consultar: Consultar, columna: string, multiple: boolean): void {
  const pedida = e.pedidaRef.current
  const c = consultaConOrden({ ...pedida, modo: e.modo }, ciclarOrden(pedida.orden, columna, multiple))
  // En JSON, el orden de texto se vacía también en lo escrito: si no, el siguiente Intro
  // lo volvería a mandar y pisaría el de la cabecera.
  if (e.modo === 'json' && e.escrito.orden !== '') e.setEscrito((prev) => ({ ...prev, orden: '' }))
  void consultar(c)
}

/** El texto con el que se abre la consola: el `find` de la colección (y `use` si la base no es la fija). */
export function textoDeConsola(baseFija: string | undefined, base: string, coleccion: string, aplicado: ConsultaColeccion): string {
  const col = /^[A-Za-z_$][\w$]*$/.test(coleccion) ? `db.${coleccion}` : `db.getCollection(${JSON.stringify(coleccion)})`
  // `;` y línea en blanco: son DOS sentencias para el divisor de la consola (un salto de
  // línea solo las uniría y el intérprete rechazaría el conjunto).
  const use = (baseFija ?? '').trim() === base ? '' : `use ${base};\n\n`
  return `${use}${col}.find(${filtroParaConsola(aplicado)})`
}
