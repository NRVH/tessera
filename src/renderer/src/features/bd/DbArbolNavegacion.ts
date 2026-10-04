// =============================================================================
// Lo que hace el lateral de BD con sus filas: ids para `aria-activedescendant`, la búsqueda
// al teclear, abrir la pestaña de una fila (un sinónimo se resuelve ANTES), las filas de
// error y de «Cargar más claves», el popover del «N de M», el archivo soltado y el orden
// por arrastre. Cada función recibe el contexto del render que la lanzó (`CtxArbol`).
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import type { DragEvent } from 'react'
import type { AnclaPopover } from './DbEsquemasPopover'
import type { NivelPopover } from './nivelBasesBd'
import { indicePadre, kindAbreTipo, paneDeFila, type FilaBd, type FilaPlaceholder } from './arbolBd'
import { cacheMetaBd } from './cacheMetaBd'
import { ETIQUETA_TIPO_OBJETO, type DbPane } from './dbTabsModel'
import { accionDeError, accionTeclaArbol, conexionDeFila, mensajeDeError, type AccionError, type FilaArbol } from './filasArbolBd'
import { patronDeFiltro } from './arbolClaves'
import { motorPorNombreDeArchivo } from './camposConexion'
import { reorderByDrag } from '../../util/reorderByDrag'
import { avisoError } from './DbArbolAcciones'
import type { CtxArbol, FiltroClaves } from './DbArbolTipos'

export function idFila(a: CtxArbol, i: number): string {
  return `${a.idBase}-f${i}`
}

export function idInsignia(a: CtxArbol, conexionId: string): string {
  return `${a.idBase}-ins-${conexionId}`
}

/** La insignia «N de M» de esquemas de una base (codificada: el nombre puede llevar de todo). */
export function idInsigniaBase(a: CtxArbol, conexionId: string, base: string): string {
  return `${a.idBase}-insb-${conexionId}-${encodeURIComponent(base)}`
}

/** Filas que caben en la ventana de la lista (para RePág/AvPág). */
export function filasPorPagina(a: CtxArbol): number {
  const alto = a.e.listaRef.current?.clientHeight ?? 0
  return Math.max(1, Math.floor(alto / Math.max(1, a.p.altoFila)) - 1)
}

export function abrirBusqueda(a: CtxArbol, inicial: string): void {
  a.e.setBusqueda((b) => (b ?? '') + inicial)
  requestAnimationFrame(() => {
    const input = a.e.busquedaRef.current
    if (!input) return
    input.focus()
    // El cursor al final: se sigue tecleando detrás de lo que ya se escribió.
    input.setSelectionRange(input.value.length, input.value.length)
  })
}

export function cerrarBusqueda(a: CtxArbol): void {
  const { expandidos, onAlternarExpandido, seleccion } = a.p
  const { filasBd, idxSel } = a.d
  // El camino hasta la fila seleccionada se despliega DE VERDAD: estaba abierto
  // solo por la búsqueda, y sin esto la selección desaparecería al cerrarla.
  // Sobre `filasBd`: una ajena está fuera de su rango y no tiene padre (-1).
  if (a.e.busqueda && idxSel >= 0) {
    let i = indicePadre(filasBd, idxSel)
    while (i >= 0) {
      const f = filasBd[i]
      if (!expandidos.has(f.key)) onAlternarExpandido(f.key, true)
      i = indicePadre(filasBd, i)
    }
    if (seleccion) a.e.llevarA(seleccion)
  }
  a.e.setBusqueda(null)
  a.e.listaRef.current?.focus()
}

/** Abre la pestaña de una fila; un sinónimo se resuelve antes y abre su destino. */
export async function abrirPane(a: CtxArbol, fila: FilaBd): Promise<void> {
  const pane = paneDeFila(fila)
  if (!pane) return
  if (pane.kind !== 'datos' || pane.tipo !== 'sinonimo') {
    a.p.onAbrir(pane)
    return
  }
  const r = await cacheMetaBd().cargarResolucion(pane.conexionId, pane.esquema, pane.objeto)
  if (!r.ok) {
    avisoError(a, `No se pudo resolver el sinónimo ${pane.objeto}: ${r.error.mensaje}`)
    return
  }
  const destino = r.valor
  const abre = kindAbreTipo(destino.tipo)
  // La base del destino: la que diga el main o, si no, la del sinónimo.
  const baseDestino = destino.base ?? pane.base
  const conBaseDestino = baseDestino !== undefined ? { base: baseDestino } : {}
  if (abre === 'datos') {
    a.p.onAbrir({ kind: 'datos', conexionId: pane.conexionId, esquema: destino.esquema, objeto: destino.nombre, tipo: destino.tipo, ...conBaseDestino })
  } else if (abre === 'fuente') {
    const p: DbPane = { kind: 'fuente', conexionId: pane.conexionId, esquema: destino.esquema, objeto: destino.nombre, tipo: destino.tipo, ...conBaseDestino }
    if (destino.firma !== undefined) p.firma = destino.firma
    a.p.onAbrir(p)
  } else {
    a.e.setAviso({
      tono: 'info',
      texto: `El sinónimo ${pane.objeto} apunta a ${ETIQUETA_TIPO_OBJETO[destino.tipo].toLowerCase()} ${destino.esquema}.${destino.nombre}, que no tiene datos que abrir.`
    })
  }
}

/**
 * Doble clic / Enter / F4 sobre una fila (contrato de `accionTeclaArbol`). Sobre una
 * ajena da siempre 'nada'; el `kind` se mira además para que el compilador deje pasar
 * la fila a `abrirPane`, que solo sabe de las del árbol.
 */
export function activarFila(a: CtxArbol, fila: FilaArbol): void {
  const accion = accionTeclaArbol(fila, 'abrir')
  if (accion === 'nada' || fila.kind === 'ajena') return
  switch (accion) {
    case 'abrir':
      void abrirPane(a, fila)
      break
    case 'expandir':
      a.p.onAlternarExpandido(fila.key, true)
      break
    case 'plegar':
      a.p.onAlternarExpandido(fila.key, false)
      break
    case 'reintentar':
      if (fila.kind === 'placeholder') ejecutarAccionError(a, fila)
      break
    case 'cargarMas':
      if (fila.kind === 'kv-mas') cargarMasClaves(a, fila.conexionId, fila.indice)
      break
    default:
      break
  }
}

/**
 * «Cargar más claves» (o «Seguir buscando», o su «Reintentar»): la vuelta siguiente del
 * SCAN de esa base. La caché deduplica y dice si ya hay una en vuelo.
 */
export function cargarMasClaves(a: CtxArbol, conexionId: string, indice: number): void {
  void cacheMetaBd()
    .cargarMasClaves(conexionId, indice)
    .catch((err: unknown) => avisoError(a, `No se pudieron cargar más claves: ${mensajeDeError(err)}`))
}

/**
 * Aplica lo escrito en «Filtrar claves…» (`patronDeFiltro`: sin comodines, en cualquier
 * parte del nombre) y despliega la base para que se vea el resultado.
 */
export function aplicarFiltroClaves(a: CtxArbol, f: FiltroClaves, escrito: string): void {
  cacheMetaBd().filtrarClaves(f.conexionId, f.indice, patronDeFiltro(escrito))
  if (!a.p.expandidos.has(f.clave)) a.p.onAlternarExpandido(f.clave, true)
  a.p.onSeleccion(f.clave)
}

export function accionDeFilaError(a: CtxArbol, fila: FilaPlaceholder): AccionError | null {
  const id = conexionDeFila(fila)
  return accionDeError(fila, id !== null ? a.d.porId.get(id) : undefined)
}

export function ejecutarAccionError(a: CtxArbol, fila: FilaPlaceholder): void {
  const acc = accionDeFilaError(a, fila)
  if (!acc) return
  if (acc.tipo === 'reintentar') a.d.reintentar(acc.carga)
  else if (acc.tipo === 'editarConexion') a.e.setDialogo({ conexionId: acc.conexionId, enfocarPassword: true })
  else a.e.setDialogo({ conexionId: acc.conexionId, abrirClientes: true, requiereDriver: acc.requiereDriver })
}

export function anclaDe(el: Element | null, x: number, y: number): AnclaPopover {
  if (el) {
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, bottom: r.bottom }
  }
  return { left: x, top: y, bottom: y }
}

export function abrirPopover(a: CtxArbol, conexionId: string, ancla: AnclaPopover, nivel?: NivelPopover, base?: string): void {
  const { popover } = a.e
  // El mismo gesto que cerró el popover (mousedown fuera sobre SU insignia) no
  // puede volver a abrirlo con el clic que le sigue.
  if (popover?.conexionId === conexionId && popover.base === base) return
  const u = a.e.ultimoCierrePopover.current
  if (u && u.conexionId === conexionId && u.base === base && performance.now() - u.en < 300) return
  a.e.setPopover({ conexionId, ancla, ...(nivel ? { nivel } : {}), ...(base !== undefined ? { base } : {}) })
}

/**
 * ¿Trae el arrastre ARCHIVOS del sistema (no una conexión del propio árbol)? Mientras se
 * arrastra, el navegador solo deja ver los tipos, no los archivos.
 */
export function arrastraArchivos(a: CtxArbol, e: DragEvent): boolean {
  return a.e.arrastre === null && Array.from(e.dataTransfer.types).includes('Files')
}

/**
 * Un archivo SOLTADO sobre el árbol: si su extensión es de un motor de archivo, el alta se
 * abre precargada con él; si no, se dice por qué no. La ruta la saca el preload y se queda
 * en el main (vuelve una ficha y el nombre). Solo el primero: una conexión es un archivo.
 */
export async function soltarArchivos(a: CtxArbol, archivos: FileList): Promise<void> {
  const archivo = archivos[0]
  if (!archivo || !a.p.perfilId || a.p.avisoFormato !== null) return
  const motor = motorPorNombreDeArchivo(archivo.name)
  if (motor === null) {
    avisoError(a, `«${archivo.name}» no parece una base de datos de archivo que Tessera sepa abrir.`)
    return
  }
  try {
    const elegido = await window.tessera.db.archivoSoltado(motor, archivo)
    a.e.setDialogo({ conexionId: null, archivoInicial: { motor, elegido } })
  } catch (err) {
    avisoError(a, mensajeDeError(err))
  }
}

export function soltarSobre(a: CtxArbol, destinoId: string): void {
  const { perfilId, conexiones } = a.p
  const arrastrado = a.e.arrastre?.id ?? null
  a.e.setArrastre(null)
  if (!arrastrado || !perfilId) return
  const nuevo = reorderByDrag(
    a.d.conexionesVista.map((c) => c.id),
    arrastrado,
    destinoId
  )
  if (!nuevo) return
  // Se pinta al instante y se persiste después: arrastrar tiene que sentirse
  // inmediato. Si la escritura falla, se vuelve a la lista de `useConexionesBd`.
  a.e.setOrdenLocal({ base: conexiones, ids: nuevo })
  void window.tessera.db.reorder(perfilId, nuevo).catch((err: unknown) => {
    a.e.setOrdenLocal(null)
    avisoError(a, `No se pudo guardar el orden: ${mensajeDeError(err)}`)
  })
}
