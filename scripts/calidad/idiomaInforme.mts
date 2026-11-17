// =============================================================================
// Datos y mensajes de la guardia de idioma: carga el glosario y las claves guardadas (del índice de git al
// commitear, del disco en los demás casos), cuenta el inglés propio de un conjunto de archivos y redacta lo que
// se le dice a quien programa: qué nombres, dónde, qué traducción propone el glosario y cómo se resuelve.
// Decisiones: docs/decisiones/calidad/idioma-del-codigo.md
// =============================================================================
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { EXT_CODIGO, RAIZ, archivosDelAmbito } from './comun.mts'
import { extraerNombres } from './idiomaDeclaraciones.mts'
import type { DatosIdioma, NombreIngles } from './idiomaDeclaraciones.mts'
import { leerObjetos } from './idiomaGit.mts'
import { TOPE_ARCHIVOS, TOPE_MILISEGUNDOS, UMBRAL_DETENER, esCodigoDelProyecto } from './idiomaCommit.mts'
import type { MedidaCommit, Veredicto } from './idiomaCommit.mts'
import { RUTA_GLOSARIO, leerClavesPersistidas, leerGlosario } from './idiomaGlosario.mts'
import { ErrorExcepciones, RUTA_EXCEPCIONES, leerExcepciones } from './idiomaExcepciones.mts'

export const RUTA_CLAVES = 'scripts/calidad/claves-persistidas.tsv'

function textoDelDisco(ruta: string): string {
  const absoluta = path.join(RAIZ, ruta)
  if (!existsSync(absoluta)) throw new Error(`falta ${ruta}`)
  return readFileSync(absoluta, 'utf8')
}

/** El glosario y las claves guardadas. Al commitear se leen del índice: se juzga lo que se va a guardar. */
export function cargarDatos(desdeElIndice = false): DatosIdioma {
  const preparados = desdeElIndice ? leerObjetos([`:${RUTA_GLOSARIO}`, `:${RUTA_CLAVES}`, `:${RUTA_EXCEPCIONES}`]) : new Map<string, string | null>()
  const texto = (ruta: string): string => {
    if (!desdeElIndice) return textoDelDisco(ruta)
    const contenido = preparados.get(`:${ruta}`)
    if (contenido === null || contenido === undefined) throw new Error(`idioma: falta ${ruta} en el índice`)
    return contenido
  }
  return { glosario: leerGlosario(texto(RUTA_GLOSARIO)), claves: leerClavesPersistidas(texto(RUTA_CLAVES)), excepciones: leerExcepciones(texto(RUTA_EXCEPCIONES)) }
}

/** Una línea por nombre: dónde está, cuál es y cómo lo traduce el glosario. */
export function describir(nombre: NombreIngles): string {
  const ubicacion = `${nombre.archivo}:${nombre.linea}`
  if (nombre.propuesta) return `  ${ubicacion}  ${nombre.nombre}  ->  ${nombre.propuesta}`
  if (nombre.sinTraduccion.length === 0) return `  ${ubicacion}  ${nombre.nombre}  ->  sin propuesta automática (palabras: ${nombre.palabras.join(', ')})`
  return `  ${ubicacion}  ${nombre.nombre}  ->  sin traducción en el glosario para: ${nombre.sinTraduccion.join(', ')}`
}

function listar(nombres: NombreIngles[], detalle: boolean, tope = 30): string[] {
  const ordenados = [...nombres].sort((a, b) => a.archivo.localeCompare(b.archivo) || a.linea - b.linea)
  const visibles = detalle ? ordenados : ordenados.slice(0, tope)
  const lineas = visibles.map(describir)
  if (visibles.length < ordenados.length) lineas.push(`  … y ${ordenados.length - visibles.length} más (--detalle para verlos todos)`)
  return lineas
}

const COMO_RESOLVERLO = [
  'Cómo resolverlo:',
  `  - Escriba cada nombre en español; a la derecha va la traducción que propone el glosario (${RUTA_GLOSARIO}).`,
  '  - Si el nombre lo impone una herramienta (una API, el DOM, una biblioteca, un formato ajeno), es una clave que se guarda o cruza de proceso, o es un término del oficio, no se traduce:',
  '    use una exención estructural, un término exacto `compuesto` del glosario o una excepción con alcance en excepciones-idioma.tsv; `se-queda` solo admite palabras válidas en todo el proyecto.',
  '  - Si la palabra falta en el glosario o no tiene traducción, añádala con la clase `se-traduce` y su traducción, en este mismo commit.',
  '  - Las claves que se guardan en disco no cambian de nombre: se leen de claves-persistidas.tsv y solo valen como propiedad de un tipo.'
]

function avisoDeOmision(medida: MedidaCommit): string {
  if (medida.omitido === 'archivos') return `AVISO idioma: el commit cambia ${medida.archivos} archivos de código y el tope es ${TOPE_ARCHIVOS}: no se midió el inglés propio.`
  if (medida.omitido === 'merge') return 'AVISO idioma: hay un merge en curso y su commit trae lo de la otra rama: no se mide el inglés propio ni se bloquea el commit.'
  if (medida.omitido === 'git') return `AVISO idioma: git pasó de ${TOPE_MILISEGUNDOS / 1000} s en entregar los archivos del commit: no se midió el inglés propio ni se bloquea el commit.`
  return `AVISO idioma: la medición pasó de ${TOPE_MILISEGUNDOS / 1000} s y se detuvo tras ${medida.analizados} de ${medida.archivos} archivos: no se bloquea el commit.`
}

/** El mensaje de un commit según su veredicto; vacío si pasa sin más. */
export function mensajeDelCommit(medida: MedidaCommit, veredicto: Veredicto, detalle: boolean): string[] {
  const fallidos = medida.fallidos.map((fallo) => `AVISO idioma: no se pudo analizar ${fallo}. Se salta ese archivo y el commit no se bloquea.`)
  if (veredicto === 'omitido') return [...fallidos, avisoDeOmision(medida)]
  if (veredicto === 'pasa' && medida.nuevos.length === 0) return fallidos
  const resumen = `el commit añade ${medida.anadidos.length} nombre(s) en inglés propio y quita ${medida.quitados.length} (saldo ${medida.saldo})`
  const cabeceras: Record<'detiene' | 'pasa', string> = {
    detiene: `Idioma: ${resumen}. Desde ${UMBRAL_DETENER} el commit se detiene.`,
    pasa: `AVISO idioma: ${resumen}. El total no sube y el commit pasa, pero estos nombres en inglés propio son nuevos:`
  }
  return [...fallidos, cabeceras[veredicto], ...listar(medida.nuevos, detalle), '', ...COMO_RESOLVERLO]
}

/** Los nombres en inglés propio de los archivos de código bajo `rutas` (todo el repo si está vacío), leídos del disco. Un archivo que no se puede analizar se salta y se nombra. */
export function contarEnDisco(rutas: string[], datos: DatosIdioma): { archivos: number; nombres: NombreIngles[]; fallidos: string[] } {
  const archivos = archivosDelAmbito(EXT_CODIGO, rutas).filter(esCodigoDelProyecto)
  const nombres: NombreIngles[] = []
  const fallidos: string[] = []
  for (const archivo of datos.excepciones?.keys() ?? []) {
    if (!archivos.includes(archivo)) extraerNombres(archivo, existsSync(path.join(RAIZ, archivo)) ? textoDelDisco(archivo) : '', datos)
  }
  for (const archivo of archivos) {
    try {
      nombres.push(...extraerNombres(archivo, readFileSync(path.join(RAIZ, archivo), 'utf8'), datos))
    } catch (error) {
      if (error instanceof ErrorExcepciones) throw error
      fallidos.push(`${archivo}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { archivos: archivos.length, nombres, fallidos }
}

/** Cuántas veces aparece cada clave, de mayor a menor. */
export function frecuencias(claves: string[]): [string, number][] {
  const cuenta = new Map<string, number>()
  for (const clave of claves) cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1)
  return [...cuenta].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** El resumen de un recuento: total, carpetas con más inglés propio y palabras más frecuentes. */
export function resumenDelRecuento(nombres: NombreIngles[], profundidad = 2): string[] {
  const carpeta = (n: NombreIngles): string => n.archivo.split('/').slice(0, profundidad).join('/')
  const formato = (pares: [string, number][]): string => pares.slice(0, 12).map(([clave, veces]) => `${clave} ${veces}`).join(', ')
  return [
    `  carpetas con más: ${formato(frecuencias(nombres.map(carpeta)))}`,
    `  palabras más frecuentes: ${formato(frecuencias(nombres.flatMap((n) => n.palabras)))}`
  ]
}
