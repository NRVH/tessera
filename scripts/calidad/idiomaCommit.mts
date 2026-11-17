// =============================================================================
// El saldo de inglés propio de un commit: los nombres que añade menos los que quita, comparando cada archivo
// de código antes y después. Un nombre que se mueve de un archivo a otro no cuenta. Un commit con demasiados
// archivos, que tarda demasiado, que cierra un merge o cuyo análisis falla no se mide ni se bloquea: se dice
// y se deja pasar.
// Depende de `idiomaDeclaraciones.mts` (qué nombres hay) e `idiomaGit.mts` (de dónde se leen).
// Decisiones: docs/decisiones/calidad/idioma-del-codigo.md
// =============================================================================
import { EXT_CODIGO, FUERA } from './comun.mts'
import { extraerNombres } from './idiomaDeclaraciones.mts'
import type { DatosIdioma, NombreIngles } from './idiomaDeclaraciones.mts'
import { TiempoAgotado, cambiosDelIndice, leerObjetos, mergeEnCurso } from './idiomaGit.mts'
import type { Cambio } from './idiomaGit.mts'
import { ErrorExcepciones, RUTA_EXCEPCIONES } from './idiomaExcepciones.mts'

/** Saldo a partir del cual el commit se detiene para impedir que aumente el inglés propio. */
export const UMBRAL_DETENER = 1
/** Archivos de código de un commit por encima de los cuales no se mide: el coste crece con cada archivo. */
export const TOPE_ARCHIVOS = 300
/** Tiempo máximo de análisis: pasado, se deja de medir y el commit pasa. */
export const TOPE_MILISEGUNDOS = 15_000

export type Veredicto = 'pasa' | 'detiene' | 'omitido'

export interface Limites {
  archivos: number
  milisegundos: number
}

export interface MedidaCommit {
  /** Archivos de código que cambia el commit. */
  archivos: number
  /** Los que se llegaron a medir. */
  analizados: number
  anadidos: NombreIngles[]
  quitados: NombreIngles[]
  /** Los añadidos que no se compensan con un nombre quitado en otro archivo. */
  nuevos: NombreIngles[]
  saldo: number
  /** Por qué no se midió (o no se acabó de medir): demasiados archivos, tiempo, un merge en curso o git sin responder. */
  omitido: 'archivos' | 'tiempo' | 'merge' | 'git' | null
  /** Los archivos cuyo análisis falló, con el motivo: se saltan y no cuentan. */
  fallidos: string[]
  milisegundos: number
}

/** Quien lee el contenido de un archivo antes o después del commit. */
export type Lector = (lado: 'antes' | 'despues', ruta: string) => string | null

/** Un archivo de código del proyecto: con extensión de código, fuera de lo que no es fuente nuestro y que no es un `.d.ts`. */
export function esCodigoDelProyecto(ruta: string | null): boolean {
  if (!ruta || !EXT_CODIGO.test(ruta) || FUERA.test(ruta) || ruta.endsWith('.d.ts')) return false
  return !ruta.split('/').includes('vendor')
}

export function clasificar(saldo: number, omitido: MedidaCommit['omitido']): Veredicto {
  if (omitido) return 'omitido'
  if (saldo >= UMBRAL_DETENER) return 'detiene'
  return 'pasa'
}

const clave = (nombre: NombreIngles): string => `${nombre.clase}:${nombre.nombre}`

/** Lo que queda de `a` tras restarle `b`, contando repeticiones: dos `x` menos una `x` deja una. */
export function restar(a: NombreIngles[], b: NombreIngles[]): NombreIngles[] {
  const disponibles = new Map<string, number>()
  for (const nombre of b) disponibles.set(clave(nombre), (disponibles.get(clave(nombre)) ?? 0) + 1)
  return a.filter((nombre) => {
    const quedan = disponibles.get(clave(nombre)) ?? 0
    if (quedan === 0) return true
    disponibles.set(clave(nombre), quedan - 1)
    return false
  })
}

function nombresDe(ruta: string | null, texto: string | null, datos: DatosIdioma, validar = false): NombreIngles[] {
  return ruta && texto !== null && esCodigoDelProyecto(ruta) ? extraerNombres(ruta, texto, datos, validar) : []
}

function medidaVacia(archivos: number, omitido: MedidaCommit['omitido'], milisegundos = 0): MedidaCommit {
  return { archivos, analizados: 0, anadidos: [], quitados: [], nuevos: [], saldo: 0, omitido, fallidos: [], milisegundos }
}

/** Mide los cambios con un lector dado; no sabe de git. Un archivo cuyo análisis falla se anota y se salta. */
export function medirTextos(cambios: Cambio[], leer: Lector, datos: DatosIdioma, limites: Limites, ahora: () => number = Date.now, validar = true): MedidaCommit {
  const inicio = ahora()
  const delProyecto = cambios.filter((c) => esCodigoDelProyecto(c.anterior) || esCodigoDelProyecto(c.posterior))
  const medida = medidaVacia(delProyecto.length, delProyecto.length > limites.archivos ? 'archivos' : null)
  for (const cambio of medida.omitido ? [] : delProyecto) {
    if (ahora() - inicio > limites.milisegundos) {
      medida.omitido = 'tiempo'
      break
    }
    try {
      const antes = nombresDe(cambio.anterior, cambio.anterior ? leer('antes', cambio.anterior) : null, datos)
      const despues = nombresDe(cambio.posterior, cambio.posterior ? leer('despues', cambio.posterior) : null, datos, validar)
      medida.anadidos.push(...restar(despues, antes))
      medida.quitados.push(...restar(antes, despues))
      medida.analizados++
    } catch (error) {
      if (error instanceof ErrorExcepciones) throw error
      medida.fallidos.push(`${cambio.posterior ?? cambio.anterior}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  medida.nuevos = restar(medida.anadidos, medida.quitados)
  medida.saldo = medida.anadidos.length - medida.quitados.length
  medida.milisegundos = ahora() - inicio
  return medida
}

/** Cómo se nombra cada lado en git: el índice (`:ruta`) frente a `HEAD`, o un commit frente a su padre. */
export interface Referencias {
  antes: (ruta: string) => string
  despues: (ruta: string) => string
}

export const REFERENCIAS_DEL_INDICE: Referencias = { antes: (ruta) => `HEAD:${ruta}`, despues: (ruta) => `:${ruta}` }

export function referenciasDelCommit(hash: string, hayPadre: boolean): Referencias {
  return { antes: (ruta) => (hayPadre ? `${hash}^:${ruta}` : `${hash}:${ruta}`), despues: (ruta) => `${hash}:${ruta}` }
}

const LIMITES: Limites = { archivos: TOPE_ARCHIVOS, milisegundos: TOPE_MILISEGUNDOS }

/** Los datos nuevos se validan enteros; si solo cambia código, bastan los archivos afectados. */
function excepcionesPorValidar(cambios: Cambio[], datos: DatosIdioma): string[] {
  const rutas = new Set(cambios.flatMap((cambio) => [cambio.anterior, cambio.posterior]))
  const todas = rutas.has(RUTA_EXCEPCIONES)
  return [...(datos.excepciones?.keys() ?? [])].filter((archivo) => todas || rutas.has(archivo))
}

/**
 * Mide los cambios leyendo de git los dos lados; no lee nada si el commit pasa del tope de archivos. El tope de
 * tiempo cubre también las órdenes de git: si una lo pasa, no se mide y el commit no se bloquea.
 */
export function medirContraGit(obtenerCambios: (limite: number) => Cambio[], referencias: Referencias, datos: DatosIdioma, limites: Limites = LIMITES, validar = false): MedidaCommit {
  const inicio = Date.now()
  const restante = (): number => limites.milisegundos - (Date.now() - inicio)
  try {
    const cambios = obtenerCambios(restante())
    const delProyecto = cambios.filter((c) => esCodigoDelProyecto(c.anterior) || esCodigoDelProyecto(c.posterior))
    const refs: string[] = []
    const excepciones = validar ? excepcionesPorValidar(cambios, datos) : []
    for (const archivo of excepciones) refs.push(referencias.despues(archivo))
    if (delProyecto.length <= limites.archivos) {
      for (const c of delProyecto) {
        if (c.anterior) refs.push(referencias.antes(c.anterior))
        if (c.posterior) refs.push(referencias.despues(c.posterior))
      }
    }
    const objetos = leerObjetos(refs, restante())
    for (const archivo of excepciones) {
      extraerNombres(archivo, objetos.get(referencias.despues(archivo)) ?? '', datos)
    }
    const leer: Lector = (lado, ruta) => objetos.get(lado === 'antes' ? referencias.antes(ruta) : referencias.despues(ruta)) ?? null
    return medirTextos(cambios, leer, datos, { ...limites, milisegundos: restante() }, Date.now, false)
  } catch (error) {
    if (!(error instanceof TiempoAgotado)) throw error
    return medidaVacia(0, 'git', Date.now() - inicio)
  }
}

/** Lo que la medida del índice necesita saber de git; se inyecta para probar sin tocar el repositorio. */
export interface OrigenDelIndice {
  mergeEnCurso: () => boolean
  cambios: (limite: number) => Cambio[]
}

const ORIGEN_REAL: OrigenDelIndice = { mergeEnCurso: () => mergeEnCurso(), cambios: cambiosDelIndice }

/** Mide lo preparado para el commit frente a `HEAD`; si hay un merge en curso no mide nada. */
export function medirIndice(datos: DatosIdioma, origen: OrigenDelIndice = ORIGEN_REAL, limites: Limites = LIMITES): MedidaCommit {
  try {
    if (origen.mergeEnCurso()) return medidaVacia(0, 'merge')
  } catch (error) {
    if (!(error instanceof TiempoAgotado)) throw error
    return medidaVacia(0, 'git')
  }
  return medirContraGit(origen.cambios, REFERENCIAS_DEL_INDICE, datos, limites, true)
}
