// =============================================================================
// Lógica pura del diff de un comprimido (.jar/.war/.ear/.zip): lados, aviso que sustituye al
// diff, migas de pan, contenido en memoria y tope del divisor.
// Lo usan `useComprimidoDiff` y `PaneComprimidoDiff`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { lenguajeDeNombreArchivo } from '../../../../shared/archivos-ipc'
import { formatoBytes } from '../../util/formatoBytes'
import { tipoVisorDeRuta } from './tipoVisor'
import { txComprimido } from './textosVisores.ts'
import type { ProblemaDiff, DestinoDiff } from './diffEditorTipos'
import type { ContenidoEnMemoria } from '../git'
import type {
  ComoEntrada,
  ResultadoComparar,
  EntradaComparada,
  ResultadoEntrada,
  LadoComprimido,
  LadoEntrada,
  ProcedenciaJava
} from '../../../../shared/comprimidos-ipc'

/** Lo mínimo que se le deja al editor de abajo: Monaco sin `automaticLayout` no tolera medir cero. */
const MIN_EDITOR = 120
/** Lo mínimo de la lista: dos filas y su cabecera. */
export const MIN_LISTA = 72
/** Techo del ajuste automático de la lista; por encima se comería el diff. */
export const MAX_LISTA_AUTO = 260
/** Lo que ocupan la cabecera de estados y el pie de recuento dentro de la lista. */
export const ALTO_CROMO_LISTA = 26

/** Un lado del contenedor, con el vocabulario del canal. */
export function aLado(destino: DestinoDiff, cual: 'before' | 'after'): LadoComprimido {
  const lado = cual === 'before' ? destino.antes : destino.despues
  return {
    origen: lado.origen,
    ...(lado.hash === undefined ? {} : { hash: lado.hash }),
    // En un alta o borrado el `path` del lado vacío sigue relleno: usarlo buscaría un archivo ausente.
    ruta: lado.origen === 'empty' ? '' : lado.ruta
  }
}

/** ¿Algún lado se lee del disco o del índice, y por tanto puede cambiar bajo los pies? */
export function ladosMutables(antes: LadoComprimido, despues: LadoComprimido): boolean {
  const fuentes = [antes.origen, despues.origen]
  return fuentes.includes('worktree') || fuentes.includes('index')
}

/** Cómo hay que preparar una entrada, o null si no hay nada que enseñar de ella. */
export function comoPedir(nombre: string): ComoEntrada | null {
  const tipo = tipoVisorDeRuta(nombre)
  if (tipo === 'javaClass') return 'java'
  if (tipo === 'monaco') return 'texto'
  return null
}

/** ¿Este lado sirve para pintar un diff? Uno que no existe sí: es la mitad vacía de un alta o borrado. */
function utilizable(lado: LadoEntrada): boolean {
  return (lado.estado === 'ok' || lado.estado === 'no-existe') && !lado.truncado
}

const elegirEntrada = (): ProblemaDiff => ({ titulo: txComprimido().elegirEntrada })

function avisoDeComparacion(c: ResultadoComparar | null): ProblemaDiff | null {
  const t = txComprimido()
  if (c !== null && c.error !== '') return { titulo: t.noSePudoComparar, pista: c.error }
  if (c !== null && c.entradas.length === 0) {
    return { titulo: t.sinDiferencias, pista: t.sinDiferenciasPista }
  }
  return null
}

function avisoBinario(fila: EntradaComparada): ProblemaDiff {
  const t = txComprimido()
  const pista =
    fila.estado === 'A'
      ? t.nueva(formatoBytes(fila.tamanoDespues))
      : fila.estado === 'D'
        ? t.borrada(formatoBytes(fila.tamanoAntes))
        : t.cambio(formatoBytes(fila.tamanoAntes), formatoBytes(fila.tamanoDespues))
  return { titulo: t.entradaBinaria, pista }
}

/** Detalle plegable con lo que dijo el descompilador, si es que se llegó a lanzar. */
function procedenciaDetalle(
  java: { antes: ProcedenciaJava | null; despues: ProcedenciaJava | null } | undefined
): string | undefined {
  const p = java?.despues ?? java?.antes
  if (p === undefined || p === null || p.diagnostico === '') return undefined
  return p.diagnostico
}

function avisoDeLado(malo: LadoEntrada, contenido: ResultadoEntrada): ProblemaDiff {
  const t = txComprimido()
  if (malo.truncado) {
    return { titulo: t.grandeEnteraTitulo, pista: t.grandeEnteraPista }
  }
  if (malo.estado === 'binario') {
    return { titulo: t.entradaBinaria, pista: malo.mensaje }
  }
  // Estado propio para no caer en «no se pudo leer», que suena a entrada corrupta.
  if (malo.estado === 'demasiado-grande') {
    return { titulo: t.grandeAquiTitulo, pista: malo.mensaje }
  }
  return {
    titulo: t.noSePudoLeerEntrada,
    pista: malo.mensaje,
    detalle: procedenciaDetalle(contenido.java)
  }
}

interface EntradaAviso {
  comparacion: ResultadoComparar | null
  cargando: boolean
  seleccionada: string | null
  contenido: ResultadoEntrada | null
  pidiendo: boolean
  porNombre: Map<string, EntradaComparada>
}

/** El aviso que sustituye al diff cuando no hay diff que enseñar. */
export function calcularAviso(x: EntradaAviso): ProblemaDiff | null {
  if (x.cargando) return { titulo: txComprimido().comparandoArchivo }
  const deComparacion = avisoDeComparacion(x.comparacion)
  if (deComparacion !== null) return deComparacion
  const fila = x.seleccionada === null ? undefined : x.porNombre.get(x.seleccionada)
  if (x.seleccionada === null || fila === undefined) return elegirEntrada()
  if (comoPedir(x.seleccionada) === null) return avisoBinario(fila)
  if (x.contenido === null || x.contenido.nombre !== x.seleccionada) {
    // Mientras llega lo nuevo no se enseña lo viejo: quien no puede enseñar lo pedido no enseña otra cosa.
    return x.pidiendo ? { titulo: txComprimido().leyendoEntrada } : elegirEntrada()
  }
  const a = x.contenido.antes
  const d = x.contenido.despues
  const malo = !utilizable(a) ? a : !utilizable(d) ? d : null
  return malo === null ? null : avisoDeLado(malo, x.contenido)
}

/**
 * Los dos textos que se le pasan al pane de diff. Siempre se pasa contenido, aunque vacío:
 * sin él el pane leería los blobs del contenedor como texto y un .jar del working-tree se
 * declararía editable.
 */
export function enMemoriaDe(contenido: ResultadoEntrada | null, dentro: string[]): ContenidoEnMemoria {
  const a = contenido?.antes
  const d = contenido?.despues
  if (contenido === null || a === undefined || d === undefined || !utilizable(a) || !utilizable(d)) {
    return { original: '', modificado: '', lenguaje: 'plaintext', unLado: false, clave: 'vacio' }
  }
  return {
    original: a.texto,
    modificado: d.texto,
    lenguaje: comoPedir(contenido.nombre) === 'java' ? 'java' : lenguajeDeNombreArchivo(contenido.nombre),
    // «Un solo lado» lo dice la entrada, no el contenedor: una clase nueva en un .jar modificado.
    unLado: a.estado === 'no-existe' || d.estado === 'no-existe',
    // Identidad O(1) para las dependencias del pane: nunca los textos (megas de memcmp por render).
    clave: `${dentro.join('!/')}|${contenido.nombre}|${a.tamano}:${a.estado}|${d.tamano}:${d.estado}|${contenido.token}`
  }
}

/** Miga de pan del contenedor y cada nivel anidado; `nivel` es a dónde vuelve el clic (null en el último). */
export function migas(
  rutaContenedor: string,
  dentro: readonly string[]
): { nombre: string; ruta: string; nivel: number | null }[] {
  const salida = [
    {
      nombre: rutaContenedor.split('/').pop() ?? rutaContenedor,
      ruta: rutaContenedor,
      nivel: dentro.length === 0 ? null : 0
    }
  ]
  dentro.forEach((n, i) => {
    salida.push({
      nombre: n.split('/').pop() ?? n,
      ruta: `${rutaContenedor}!/${dentro.slice(0, i + 1).join('!/')}`,
      nivel: i === dentro.length - 1 ? null : i + 1
    })
  })
  return salida
}

/** Tooltip de una entrada: qué le pasó y cuánto ocupa a cada lado. */
export function tituloEntrada(e: EntradaComparada): string {
  const t = txComprimido()
  if (e.estado === 'A') return t.tituloNueva(e.nombre, formatoBytes(e.tamanoDespues))
  if (e.estado === 'D') return t.tituloBorrada(e.nombre, formatoBytes(e.tamanoAntes))
  return t.tituloModificada(e.nombre, formatoBytes(e.tamanoAntes), formatoBytes(e.tamanoDespues))
}

/** Techo del divisor: lo que hay, menos lo que el editor no puede perder. */
export function maxLista(zona: HTMLDivElement | null): number {
  const seccion = zona?.parentElement
  if (!seccion) return MAX_LISTA_AUTO
  let fijo = 0
  for (const hijo of Array.from(seccion.children)) {
    if (hijo === zona) continue
    if ((hijo as HTMLElement).classList.contains('editor-host')) continue
    fijo += (hijo as HTMLElement).offsetHeight
  }
  return Math.max(MIN_LISTA, seccion.clientHeight - fijo - MIN_EDITOR)
}
