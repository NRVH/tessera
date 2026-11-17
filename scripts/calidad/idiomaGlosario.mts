// =============================================================================
// Vocabulario de la guardia de idioma: lee `glosario-identificadores.tsv`, parte un identificador en
// palabras y decide con evidencia positiva si alguna es inglés propio y cómo se traduce. Una palabra
// desconocida nunca es un hallazgo. Lógica pura: no lee archivos ni git.
// Decisiones: docs/decisiones/calidad/idioma-del-codigo.md
// =============================================================================
import { leerLista } from './clavesPersistidas.mts'

/** Qué es cada palabra del glosario. */
export type ClaseGlosario = 'se-traduce' | 'se-queda' | 'abreviatura' | 'abreviatura-inglesa' | 'inglesa' | 'compuesto'

const CLASES: readonly ClaseGlosario[] = ['se-traduce', 'se-queda', 'abreviatura', 'abreviatura-inglesa', 'inglesa', 'compuesto']

/** Ruta del glosario, relativa a la raíz del repo. */
export const RUTA_GLOSARIO = 'scripts/calidad/glosario-identificadores.tsv'

export interface Glosario {
  compuestos: Set<string>
  /** Palabras inglesas con traducción en el glosario. */
  traducciones: Map<string, string>
  /** Palabras que nunca se marcan: términos del oficio, impuestas, españolas, cognados y abreviaturas admitidas. */
  permitidas: Set<string>
  /** Abreviaturas inglesas, por la palabra exacta: `props` no es `prop`. */
  abreviaturasInglesas: Map<string, string>
  /** Palabras inglesas conocidas que el glosario no traduce (la traducción puede venir vacía). */
  inglesas: Map<string, string>
}

export interface Evidencia {
  traduccion: string | null
  fuente: 'glosario' | 'abreviatura' | 'inglesa'
}

export interface Evaluacion {
  /** Las palabras inglesas del nombre, en minúscula. */
  palabras: string[]
  /** Las que el glosario no sabe traducir. */
  sinTraduccion: string[]
  /** El nombre con las palabras inglesas traducidas, o null si alguna no tiene traducción. */
  propuesta: string | null
}

export interface OpcionesNombre {
  /** Si el nombre admite los prefijos `on` y `set` (parámetros, variables y miembros). */
  admitePrefijo: boolean
  /** Si la variable se inicializa con el nombre de una plataforma (`'windows'`, `'win32'`). */
  plataforma: boolean
}

/** Filas de datos de un TSV: sin comentarios `#`, líneas en blanco ni la fila de títulos. */
export function filasDeTsv(texto: string): string[][] {
  return texto
    .split(/\r?\n/)
    .filter((linea) => linea.trim() !== '' && !linea.startsWith('#'))
    .slice(1)
    .map((linea) => linea.split('\t'))
}

function agregarCompuesto(glosario: Glosario, palabra: string, traduccion: string): void {
  if (traduccion) throw new Error(`glosario: un compuesto no lleva traducción: ${palabra}`)
  glosario.compuestos.add(palabra)
}

/** Carga el glosario. Una fila mal formada o una palabra repetida es un error: el dato no se interpreta a medias. */
export function leerGlosario(texto: string): Glosario {
  const glosario: Glosario = { compuestos: new Set(), traducciones: new Map(), permitidas: new Set(), abreviaturasInglesas: new Map(), inglesas: new Map() }
  const vistas = new Set<string>()
  for (const [palabra, clase, traduccion = ''] of filasDeTsv(texto)) {
    const fila = `${palabra}\t${clase}\t${traduccion}`
    if (!palabra || !(clase === 'compuesto' ? /^[A-Za-z][A-Za-z0-9]*$/ : /^[a-z0-9]+$/).test(palabra)) throw new Error(`glosario: palabra no válida (minúscula y sin tildes salvo compuesto): ${fila}`)
    if (!CLASES.includes(clase as ClaseGlosario)) throw new Error(`glosario: clase desconocida: ${fila}`)
    if (vistas.has(palabra)) throw new Error(`glosario: palabra repetida: ${palabra}`)
    vistas.add(palabra)
    const conTraduccion = clase === 'se-traduce' || clase === 'abreviatura-inglesa'
    if (conTraduccion && !traduccion) throw new Error(`glosario: falta la traducción: ${fila}`)
    if (clase === 'compuesto') agregarCompuesto(glosario, palabra, traduccion)
    else if (clase === 'se-traduce') glosario.traducciones.set(palabra, traduccion)
    else if (clase === 'abreviatura-inglesa') glosario.abreviaturasInglesas.set(palabra, traduccion)
    else if (clase === 'inglesa') glosario.inglesas.set(palabra, traduccion)
    else glosario.permitidas.add(palabra)
  }
  return glosario
}

/**
 * Los nombres de las claves vigentes que Tessera guarda en disco o intercambia, según `claves-persistidas.tsv`
 * (la última parte de cada ruta), leído y validado por la guardia de claves persistidas. Las rutas de valores
 * (`…="x"`) y los comodines no son nombres.
 */
export function leerClavesPersistidas(texto: string): Set<string> {
  const claves = new Set<string>()
  for (const { ruta, estado } of leerLista(texto)) {
    if (estado !== 'vigente' || ruta.includes('=')) continue
    const nombre = ruta.replace(/\[\]/g, '').split(/[#.]/).at(-1)
    if (nombre && nombre !== '*') claves.add(nombre)
  }
  return claves
}

/** Palabras que, junto a `win`, indican que habla del sistema operativo y no de una ventana. */
const CONTEXTO_PLATAFORMA = new Set([
  'ruta', 'carpeta', 'path', 'dir', 'directorio', 'archivo', 'file', 'exe', 'cmd', 'proyecto', 'en', 'es', 'solo', 'mac', 'linux',
  'posix', 'shim', 'bat', 'unidad', 'drive', 'sep', 'copia'
])

/** Un trozo de un identificador: su texto con los dígitos que lo cierran, sus letras y dónde empieza en el nombre. */
interface Trozo {
  texto: string
  letras: string
  indice: number
}

/** Una sigla, una palabra con su mayúscula inicial o unas letras sueltas, cada una con los dígitos que le siguen (`base64`, `V2`). */
const TROZO = /\p{Lu}+(?!\p{Ll})\d*|\p{Lu}?\p{Ll}+\d*|\p{L}+\d*/gu

function trozosDe(nombre: string, compuestos: Iterable<string> = []): Trozo[] {
  let texto = nombre
  const originales = [...texto.matchAll(TROZO)]
  const inicios = new Set(originales.map((trozo) => trozo.index))
  const finales = new Set(originales.map((trozo) => trozo.index + trozo[0].length))
  for (const compuesto of [...compuestos].sort((a, b) => b.length - a.length)) {
    let indice = texto.indexOf(compuesto)
    while (indice >= 0) {
      if (inicios.has(indice) && finales.has(indice + compuesto.length)) {
        texto = texto.slice(0, indice) + ' '.repeat(compuesto.length) + texto.slice(indice + compuesto.length)
      }
      indice = texto.indexOf(compuesto, indice + compuesto.length)
    }
  }
  return [...texto.matchAll(TROZO)].map((m) => ({ texto: m[0], letras: m[0].replace(/\d+$/, ''), indice: m.index }))
}

/** Las palabras de un identificador (`profileId` → `profile`, `Id`; `base64Data` → `base64`, `Data`), separadas por mayúsculas y `_`. */
export function palabrasDe(nombre: string): string[] {
  return trozosDe(nombre).map((trozo) => trozo.texto)
}

/** Formas por las que se busca una palabra: ella misma, su singular y su raíz verbal. */
export function formasDe(palabra: string): string[] {
  const formas = [palabra]
  if (palabra.length > 3 && palabra.endsWith('s')) formas.push(palabra.slice(0, -1))
  if (palabra.length > 4 && palabra.endsWith('es')) formas.push(palabra.slice(0, -2))
  if (palabra.length > 4 && palabra.endsWith('ies')) formas.push(palabra.slice(0, -3) + 'y')
  if (palabra.length > 4 && palabra.endsWith('ed')) formas.push(palabra.slice(0, -2), palabra.slice(0, -1))
  if (palabra.length > 5 && palabra.endsWith('ing')) formas.push(palabra.slice(0, -3), palabra.slice(0, -3) + 'e')
  return formas
}

/** Si la palabra es el plural de la forma que el glosario traduce, la traducción va en plural (`s` tras vocal, `es` tras consonante). */
function pluralDe(palabra: string, forma: string, traduccion: string): string {
  if (palabra !== `${forma}s` && palabra !== `${forma}es`) return traduccion
  return /[aeiou]$/.test(traduccion) ? `${traduccion}s` : `${traduccion}es`
}

/** La evidencia de que una palabra es inglesa, o null si es permitida, española o desconocida. */
export function evidenciaIngles(glosario: Glosario, palabra: string): Evidencia | null {
  const formas = formasDe(palabra)
  if (formas.some((forma) => glosario.permitidas.has(forma))) return null
  const abreviatura = glosario.abreviaturasInglesas.get(palabra)
  if (abreviatura) return { traduccion: abreviatura, fuente: 'abreviatura' }
  for (const forma of formas) {
    const traduccion = glosario.traducciones.get(forma)
    if (traduccion) return { traduccion: pluralDe(palabra, forma, traduccion), fuente: 'glosario' }
  }
  for (const forma of formas) {
    const traduccion = glosario.inglesas.get(forma)
    if (traduccion !== undefined) return { traduccion: traduccion || null, fuente: 'inglesa' }
  }
  return null
}

/** `win` es el sistema operativo junto a una palabra de plataforma; `windows` lo es detrás de otra palabra. */
function esSistemaOperativo(palabra: string, indice: number, trozos: Trozo[], plataforma: boolean): boolean {
  if (palabra === 'windows') return indice > 0
  if (palabra !== 'win') return false
  return plataforma || trozos.some((otro, posicion) => posicion !== indice && CONTEXTO_PLATAFORMA.has(otro.letras.toLowerCase()))
}

/** Las convenciones conservan el prefijo o sufijo en inglés y evalúan el resto: `use…`, `on…`, `set…`, `…Props`. */
function esConvencion(trozos: Trozo[], indice: number, admitePrefijo: boolean): boolean {
  const palabra = trozos[indice].letras.toLowerCase()
  const hayResto = trozos.length > 1
  if (palabra === 'use') return indice === 0
  if (palabra === 'props') return indice === trozos.length - 1 || (indice === 0 && hayResto)
  if (palabra === 'set' && trozos[0].texto === 'Set') return indice === 0 && hayResto
  return (palabra === 'on' || palabra === 'set') && indice === 0 && hayResto && admitePrefijo
}

/** Una palabra seguida de dígitos que el glosario conoce entera (`win32`, `base64`, `sha256`) es ese término, no su palabra inglesa. */
const esTerminoConDigitos = (glosario: Glosario, trozo: Trozo): boolean =>
  trozo.texto !== trozo.letras && glosario.permitidas.has(trozo.texto.toLowerCase())

function evidenciaDeTrozo(glosario: Glosario, trozos: Trozo[], indice: number, op: OpcionesNombre): Evidencia | null {
  const trozo = trozos[indice]
  if (trozo.letras.length === 1 || /[áéíóúñ]/i.test(trozo.letras) || esTerminoConDigitos(glosario, trozo)) return null
  if (esConvencion(trozos, indice, op.admitePrefijo)) return null
  const palabra = trozo.letras.toLowerCase()
  if (esSistemaOperativo(palabra, indice, trozos, op.plataforma)) return null
  return evidenciaIngles(glosario, palabra)
}

/** El nombre escrito entero en mayúsculas (`PROFILE_PATH`, `_ID`): sus palabras traducidas también van en mayúsculas. */
const esConstante = (nombre: string): boolean => /^[_#]*[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(nombre)

/** Roles usados delante del concepto en los nombres españoles; `store` y `props` son convenciones. */
const ROLES = new Set([
  'service', 'manager', 'options', 'request', 'result', 'handler', 'provider', 'controller', 'config', 'state', 'info', 'error'
])

const PREFIJOS_VERBALES = new Set([
  'get', 'read', 'load', 'fetch', 'find', 'list', 'create', 'build', 'make', 'save', 'write', 'delete', 'remove', 'clear',
  'check', 'validate', 'handle', 'ensure', 'parse', 'toggle', 'update', 'refresh', 'set', 'use', 'on'
])

const conMayuscula = (texto: string): string => texto.charAt(0).toUpperCase() + texto.slice(1)

/** Solo un rol final y un concepto sin prefijo verbal permiten decidir el orden sin interpretar la declaración. */
function anteponerRol(nombre: string, trozos: Trozo[], traducciones: (string | null)[]): string | null {
  const ultimo = trozos.length - 1
  if (trozos.slice(0, ultimo).some((trozo) => ROLES.has(trozo.letras.toLowerCase()))) return null
  if (PREFIJOS_VERBALES.has(trozos[0].letras.toLowerCase())) return null
  if (!/^[_#$]*\p{L}[\p{L}\d]*$/u.test(nombre) || esConstante(nombre)) return null
  const inicio = trozos[0].indice
  if (!/^[_#$]*$/.test(nombre.slice(0, inicio)) || nombre.slice(inicio) !== trozos.map((trozo) => trozo.texto).join('')) return null
  const rol = traducciones[ultimo] ?? trozos[ultimo].texto.toLowerCase()
  const concepto = trozos.slice(0, ultimo).map((trozo, i) => {
    const texto = traducciones[i] === null ? trozo.texto : traducciones[i]! + trozo.texto.slice(trozo.letras.length)
    return conMayuscula(texto)
  }).join('')
  const prefijo = /^\p{Lu}/u.test(trozos[0].letras) ? conMayuscula(rol) : rol
  return nombre.slice(0, inicio) + prefijo + trozos[ultimo].texto.slice(trozos[ultimo].letras.length) + concepto
}

/**
 * Traduce cada palabra y antepone el rol final cuando el orden es seguro. Conserva la forma del nombre;
 * devuelve null si el orden es ambiguo, lo que sale no es un nombre válido o no cambia nada.
 */
function componer(nombre: string, trozos: Trozo[], traducciones: (string | null)[]): string | null {
  const constante = esConstante(nombre)
  let propuesta = nombre
  if (trozos.length > 1 && ROLES.has(trozos.at(-1)!.letras.toLowerCase())) {
    propuesta = anteponerRol(nombre, trozos, traducciones) ?? ''
    return propuesta !== nombre && /^[#_$\p{L}\d-]+$/u.test(propuesta) ? propuesta : null
  }
  for (let i = trozos.length - 1; i >= 0; i--) {
    const traduccion = traducciones[i]
    if (traduccion === null) continue
    const { letras, indice } = trozos[i]
    const escrita = constante ? traduccion.toUpperCase() : /^\p{Lu}/u.test(letras) ? traduccion.charAt(0).toUpperCase() + traduccion.slice(1) : traduccion
    propuesta = propuesta.slice(0, indice) + escrita + propuesta.slice(indice + letras.length)
  }
  return propuesta !== nombre && /^[#_$\p{L}\d-]+$/u.test(propuesta) ? propuesta : null
}

/** Evalúa un identificador: null si no tiene inglés propio; si lo tiene, sus palabras y la traducción propuesta (null si no hay una segura). */
export function evaluarNombre(glosario: Glosario, nombre: string, op: OpcionesNombre): Evaluacion | null {
  if (['set', 'get', 'has'].includes(nombre)) return null
  const trozos = trozosDe(nombre, glosario.compuestos)
  const palabras: string[] = []
  const sinTraduccion: string[] = []
  const traducciones = trozos.map((trozo, indice): string | null => {
    const evidencia = evidenciaDeTrozo(glosario, trozos, indice, op)
    if (!evidencia) return null
    palabras.push(trozo.letras.toLowerCase())
    if (evidencia.traduccion === null) sinTraduccion.push(trozo.letras.toLowerCase())
    return evidencia.traduccion
  })
  if (palabras.length === 0) return null
  return { palabras, sinTraduccion, propuesta: sinTraduccion.length === 0 ? componer(nombre, trozos, traducciones) : null }
}
