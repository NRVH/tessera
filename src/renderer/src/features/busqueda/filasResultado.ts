// =============================================================================
// El estado de la lista de resultados de la búsqueda en archivos. Puro (sin React ni DOM):
// se prueba con `node` el filtro por id, el recuento y la navegación.
// La lista es plana, una fila por coincidencia: se recorre, no se explora por archivo.
// El contador no miente: al alcanzar el tope dice «N+», nunca un total redondo.
// =============================================================================
import type { CoincidenciaArchivo, FinBusqueda, LoteResultados } from '../../../../shared/search-ipc'

export interface EstadoBusqueda {
  /** Id de la búsqueda VIVA. Todo lote con otro id se descarta. */
  busquedaId: number
  /** Coincidencias acumuladas, en orden de llegada. */
  filas: CoincidenciaArchivo[]
  /** Índice de la fila seleccionada; -1 si ninguna. */
  seleccion: number
  /** true mientras el barrido sigue. */
  buscando: boolean
  /** true si se alcanzó el tope: el contador dice "N+". */
  truncado: boolean
  /** Archivos DISTINTOS con coincidencias (lo dice el main al terminar). */
  archivos: number
  /** Mensaje humano si el barrido falló. */
  error: string | null
}

export const ESTADO_INICIAL: EstadoBusqueda = {
  busquedaId: 0,
  filas: [],
  seleccion: -1,
  buscando: false,
  truncado: false,
  archivos: 0,
  error: null
}

/** Arranca una búsqueda nueva: vacía todo y fija el id que manda a partir de ahora. */
export function iniciarBusqueda(busquedaId: number): EstadoBusqueda {
  return { ...ESTADO_INICIAL, busquedaId, buscando: true }
}

/**
 * Añade un lote. Un lote de OTRA búsqueda se ignora, y ese filtro es la razón de
 * ser del id: al teclear, cada pulsación cancela la anterior, pero los mensajes que
 * esa ya había puesto en la cola del IPC siguen llegando. Sin esto se mezclarían
 * con los de la consulta actual, sin nada que lo delatara.
 *
 * La PRIMERA fila que llega se selecciona sola: es lo que hace que la vista previa
 * aparezca sin tener que pulsar nada.
 */
export function agregarLote(estado: EstadoBusqueda, lote: LoteResultados): EstadoBusqueda {
  if (lote.busquedaId !== estado.busquedaId) return estado
  if (lote.coincidencias.length === 0) return estado
  const filas = estado.filas.concat(lote.coincidencias)
  return {
    ...estado,
    filas,
    seleccion: estado.seleccion < 0 ? 0 : estado.seleccion
  }
}

/** Cierra la búsqueda con lo que diga el main. Un fin de otra búsqueda se ignora. */
export function terminarBusqueda(estado: EstadoBusqueda, fin: FinBusqueda): EstadoBusqueda {
  if (fin.busquedaId !== estado.busquedaId) return estado
  return {
    ...estado,
    buscando: false,
    truncado: fin.truncado,
    // `archivos` lo cuenta el main sobre TODO lo encontrado; el renderer solo tiene
    // lo que le cabe. Si se truncó, se queda con el suyo para no enseñar un número
    // de archivos mayor que el de las filas que hay.
    archivos: fin.archivos,
    error: fin.error ?? null
  }
}

/** Selección explícita (clic). Fuera de rango, no hace nada. */
export function seleccionar(estado: EstadoBusqueda, indice: number): EstadoBusqueda {
  if (indice < 0 || indice >= estado.filas.length || indice === estado.seleccion) return estado
  return { ...estado, seleccion: indice }
}

/**
 * Mueve la selección con ↑/↓. **NO es circular**, a diferencia del buscador de
 * documento: allí se recorre un anillo de coincidencias de un mismo texto y volver
 * al principio es lo esperado; aquí es una lista que se está LLENANDO mientras
 * llegan lotes, y saltar del final al principio con el usuario bajando movería el
 * suelo bajo el cursor. Se para en los extremos, como cualquier lista de un IDE.
 */
export function mover(estado: EstadoBusqueda, dir: 'arriba' | 'abajo'): EstadoBusqueda {
  if (estado.filas.length === 0) return estado
  if (estado.seleccion < 0) return { ...estado, seleccion: dir === 'abajo' ? 0 : estado.filas.length - 1 }
  const siguiente = dir === 'abajo' ? estado.seleccion + 1 : estado.seleccion - 1
  if (siguiente < 0 || siguiente >= estado.filas.length) return estado
  return { ...estado, seleccion: siguiente }
}

/** La fila seleccionada, o null. */
export function filaSeleccionada(estado: EstadoBusqueda): CoincidenciaArchivo | null {
  return estado.seleccion >= 0 && estado.seleccion < estado.filas.length
    ? estado.filas[estado.seleccion]
    : null
}

/**
 * El texto del contador, tal cual se pinta bajo el recuadro.
 *
 * Cuenta los archivos DE LAS FILAS que hay, no el `archivos` del main, cuando se
 * truncó: decir "11 archivos" enseñando coincidencias de 4 sería incoherente en la
 * misma línea.
 */
export function textoContador(estado: EstadoBusqueda, hayConsulta: boolean): string {
  if (estado.error !== null) return estado.error
  if (!hayConsulta) return ''
  if (estado.filas.length === 0) {
    return estado.buscando ? 'Buscando…' : 'Ningún resultado'
  }
  const archivos = estado.truncado
    ? new Set(estado.filas.map((f) => f.path)).size
    : Math.max(estado.archivos, new Set(estado.filas.map((f) => f.path)).size)
  const mas = estado.truncado ? '+' : ''
  const c = `${estado.filas.length}${mas} ${estado.filas.length === 1 && !estado.truncado ? 'coincidencia' : 'coincidencias'}`
  const a = `${archivos}${mas} ${archivos === 1 && !estado.truncado ? 'archivo' : 'archivos'}`
  return estado.buscando ? `${c} en ${a} · buscando…` : `${c} en ${a}`
}

/**
 * Ruta de la CARPETA que se enseña en gris detrás del nombre.
 * '' si el archivo está en la raíz.
 *
 * Para una ruta VIRTUAL ("lib/x.jar!/com/A.class") se enseña el tramo de dentro del
 * contenedor precedido del jar, que es lo que sitúa de verdad: "lib/x.jar!/com".
 * Cortar por el último '/' a secas funciona para ambos casos porque el separador
 * de contenedor termina en '/'.
 */
export function carpetaDe(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}
