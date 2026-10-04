// =============================================================================
// Lógica pura del diff de un comprimido (.jar/.war/.ear/.zip): lados, aviso que sustituye al
// diff, migas de pan, contenido en memoria y tope del divisor.
// Lo usan `useComprimidoDiff` y `ComprimidoDiffPane`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { languageForFilename } from '../../../../shared/files-ipc'
import { formatoBytes } from '../../util/formatoBytes'
import { viewerKindForPath } from './viewerKind'
import type { DiffProblem, DiffTarget } from './diffEditorTipos'
import type { ContenidoEnMemoria } from '../git'
import type {
  ComoEntrada,
  CompararResult,
  EntradaComparada,
  EntradaResult,
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
export function aLado(target: DiffTarget, cual: 'before' | 'after'): LadoComprimido {
  const lado = cual === 'before' ? target.before : target.after
  return {
    source: lado.source,
    ...(lado.hash === undefined ? {} : { hash: lado.hash }),
    // En un alta o borrado el `path` del lado vacío sigue relleno: usarlo buscaría un archivo ausente.
    path: lado.source === 'empty' ? '' : lado.path
  }
}

/** ¿Algún lado se lee del disco o del índice, y por tanto puede cambiar bajo los pies? */
export function ladosMutables(antes: LadoComprimido, despues: LadoComprimido): boolean {
  const fuentes = [antes.source, despues.source]
  return fuentes.includes('worktree') || fuentes.includes('index')
}

/** Cómo hay que preparar una entrada, o null si no hay nada que enseñar de ella. */
export function comoPedir(nombre: string): ComoEntrada | null {
  const kind = viewerKindForPath(nombre)
  if (kind === 'javaClass') return 'java'
  if (kind === 'monaco') return 'texto'
  return null
}

/** ¿Este lado sirve para pintar un diff? Uno que no existe sí: es la mitad vacía de un alta o borrado. */
function utilizable(lado: LadoEntrada): boolean {
  return (lado.estado === 'ok' || lado.estado === 'no-existe') && !lado.truncado
}

const elegirEntrada = (): DiffProblem => ({ title: 'Elige una entrada para ver sus diferencias' })

function avisoDeComparacion(c: CompararResult | null): DiffProblem | null {
  if (c !== null && c.error !== '') return { title: 'No se pudo comparar el archivo', hint: c.error }
  if (c !== null && c.entradas.length === 0) {
    return {
      title: 'Sin diferencias dentro del archivo',
      hint: 'Las dos versiones del comprimido tienen el mismo contenido. Pueden diferir en fechas o en el orden de las entradas, que no cambian lo que hay dentro.'
    }
  }
  return null
}

function avisoBinario(fila: EntradaComparada): DiffProblem {
  const hint =
    fila.estado === 'A'
      ? `Nueva, ${formatoBytes(fila.tamanoDespues)}.`
      : fila.estado === 'D'
        ? `Borrada; ocupaba ${formatoBytes(fila.tamanoAntes)}.`
        : `Cambió de ${formatoBytes(fila.tamanoAntes)} a ${formatoBytes(fila.tamanoDespues)}.`
  return { title: 'Entrada binaria: no hay diff de texto que mostrar.', hint }
}

/** Detalle plegable con lo que dijo el descompilador, si es que se llegó a lanzar. */
function procedenciaDetalle(
  java: { antes: ProcedenciaJava | null; despues: ProcedenciaJava | null } | undefined
): string | undefined {
  const p = java?.despues ?? java?.antes
  if (p === undefined || p === null || p.diagnostico === '') return undefined
  return p.diagnostico
}

function avisoDeLado(malo: LadoEntrada, contenido: EntradaResult): DiffProblem {
  if (malo.truncado) {
    return {
      title: 'La entrada es demasiado grande para compararla entera.',
      hint: 'Sólo se pudo leer el principio, y un diff a medias se leería como un borrado gigante.'
    }
  }
  if (malo.estado === 'binario') {
    return { title: 'Entrada binaria: no hay diff de texto que mostrar.', hint: malo.mensaje }
  }
  // Estado propio para no caer en «no se pudo leer», que suena a entrada corrupta.
  if (malo.estado === 'demasiado-grande') {
    return { title: 'La entrada es demasiado grande para compararla aquí.', hint: malo.mensaje }
  }
  return {
    title: 'No se pudo leer esta entrada',
    hint: malo.mensaje,
    detail: procedenciaDetalle(contenido.java)
  }
}

interface EntradaAviso {
  comparacion: CompararResult | null
  cargando: boolean
  seleccionada: string | null
  contenido: EntradaResult | null
  pidiendo: boolean
  porNombre: Map<string, EntradaComparada>
}

/** El aviso que sustituye al diff cuando no hay diff que enseñar. */
export function calcularAviso(x: EntradaAviso): DiffProblem | null {
  if (x.cargando) return { title: 'Comparando el archivo…' }
  const deComparacion = avisoDeComparacion(x.comparacion)
  if (deComparacion !== null) return deComparacion
  const fila = x.seleccionada === null ? undefined : x.porNombre.get(x.seleccionada)
  if (x.seleccionada === null || fila === undefined) return elegirEntrada()
  if (comoPedir(x.seleccionada) === null) return avisoBinario(fila)
  if (x.contenido === null || x.contenido.nombre !== x.seleccionada) {
    // Mientras llega lo nuevo no se enseña lo viejo: quien no puede enseñar lo pedido no enseña otra cosa.
    return x.pidiendo ? { title: 'Leyendo la entrada…' } : elegirEntrada()
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
export function enMemoriaDe(contenido: EntradaResult | null, dentro: string[]): ContenidoEnMemoria {
  const a = contenido?.antes
  const d = contenido?.despues
  if (contenido === null || a === undefined || d === undefined || !utilizable(a) || !utilizable(d)) {
    return { original: '', modificado: '', lenguaje: 'plaintext', unLado: false, clave: 'vacio' }
  }
  return {
    original: a.texto,
    modificado: d.texto,
    lenguaje: comoPedir(contenido.nombre) === 'java' ? 'java' : languageForFilename(contenido.nombre),
    // «Un solo lado» lo dice la entrada, no el contenedor: una clase nueva en un .jar modificado.
    unLado: a.estado === 'no-existe' || d.estado === 'no-existe',
    // Identidad O(1) para las dependencias del pane: nunca los textos (megas de memcmp por render).
    clave: `${dentro.join('!/')}|${contenido.nombre}|${a.tamano}:${a.estado}|${d.tamano}:${d.estado}|${contenido.token}`
  }
}

/** Miga de pan del contenedor y cada nivel anidado; `nivel` es a dónde vuelve el clic (null en el último). */
export function migas(
  pathContenedor: string,
  dentro: readonly string[]
): { nombre: string; ruta: string; nivel: number | null }[] {
  const salida = [
    {
      nombre: pathContenedor.split('/').pop() ?? pathContenedor,
      ruta: pathContenedor,
      nivel: dentro.length === 0 ? null : 0
    }
  ]
  dentro.forEach((n, i) => {
    salida.push({
      nombre: n.split('/').pop() ?? n,
      ruta: `${pathContenedor}!/${dentro.slice(0, i + 1).join('!/')}`,
      nivel: i === dentro.length - 1 ? null : i + 1
    })
  })
  return salida
}

/** Tooltip de una entrada: qué le pasó y cuánto ocupa a cada lado. */
export function tituloEntrada(e: EntradaComparada): string {
  if (e.estado === 'A') return `${e.nombre}\nNueva · ${formatoBytes(e.tamanoDespues)}`
  if (e.estado === 'D') return `${e.nombre}\nBorrada · ocupaba ${formatoBytes(e.tamanoAntes)}`
  return `${e.nombre}\nModificada · ${formatoBytes(e.tamanoAntes)} → ${formatoBytes(e.tamanoDespues)}`
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
