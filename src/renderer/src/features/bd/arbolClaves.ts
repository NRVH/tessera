// =============================================================================
// arbolClaves: lo que el árbol de bases de datos decide para una conexión de claves: las
// bases numeradas, el recorrido SCAN por base, las carpetas por `:` y la fila «Cargar más».
// Puro: sin React, DOM ni IPC; lo fija `test-arbol-bd.mts`. Hermano de `arbolDocumentos.ts`.
// Hoja: solo importa valores de `claves/bytesClaves.ts`, y lo importan las piezas de `arbolBd.ts`
// (`arbolBdNodosFamilias.ts`, `arbolBdTipos.ts`, `arbolBdPanes.ts`); un valor de `arbolBd*` aquí
// cerraría un ciclo que compila y revienta al cargar.
// Decisiones: docs/decisiones/bd/ui-claves-arbol.md
// =============================================================================

import type { DbKvBases, DbKvBytes, DbKvClave, DbKvPaginaClaves } from '../../../../shared/db-claves-ipc.ts'
import type { DbErrorSql, DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import type { DescriptorClaves } from '../../../../shared/motores/index.ts'
import { pintarBytes } from './claves/bytesClaves.ts'

/** El COUNT de cada vuelta de SCAN (una pista para el servidor, no un tope exacto). */
export const CUENTA_ESCANEO = 500

/** Vueltas de SCAN que se piden solas, por clic, mientras no llegue ninguna clave. */
export const VUELTAS_POR_CLIC = 10

/** El separador de las carpetas: el de la convención de Redis (`objeto:id:campo`). */
export const SEPARADOR_CARPETAS = ':'

/** Los textos del árbol de claves que no dependen de los datos. */
export const TEXTOS_CLAVES = {
  sinClaves: 'Sin claves',
  cargarMas: 'Cargar más claves',
  seguirBuscando: 'Seguir buscando',
  cargando: 'Cargando más claves…',
  reintentar: 'Reintentar'
} as const

/** Lo que dice una base sin ninguna clave que case con su patrón. */
export function textoSinCoincidencias(patron: string): string {
  return `Ninguna clave casa con ${patron}`
}

/**
 * La base con la que se abre la conexión: el NÚMERO escrito en `database` (0 si va vacío o
 * no es un número; el main lo valida al guardar).
 */
export function basePorDefectoClaves(c: { database?: string | null }): number {
  const t = (c.database ?? '').trim()
  return /^\d{1,4}$/.test(t) ? Number(t) : 0
}

/** Una base de la lista del árbol. */
export interface BaseClaves {
  indice: number
  /**
   * Claves según `INFO keyspace`: 0 si no aparece; null si no se sabe (la lista no vino del
   * servidor, o vino con `conteosDesconocidos`). Con null la base se recorre igual.
   */
  claves: number | null
  /** La que abre la conexión (`basePorDefectoClaves`). */
  porDefecto: boolean
}

/**
 * Las bases 0…n-1 que pinta el árbol. Con la respuesta del main, su `total` y sus conteos
 * (salvo `conteosDesconocidos`: ninguno); sin ella (la petición falló), las
 * `basesPorDefecto` del descriptor sin conteo. Un `total` que no sea un entero positivo se
 * trata como ausente.
 */
export function basesDeClaves(resp: DbKvBases | null, d: DescriptorClaves, c: { database?: string | null }): BaseClaves[] {
  const total = resp !== null && Number.isInteger(resp.total) && resp.total > 0 ? resp.total : d.claves.basesPorDefecto
  const conocidos = resp !== null && resp.conteosDesconocidos !== true
  const conteo = new Map<number, number>()
  if (conocidos) for (const x of resp.conClaves) conteo.set(x.indice, x.claves)
  const porDefecto = basePorDefectoClaves(c)
  const out: BaseClaves[] = []
  for (let i = 0; i < total; i++) {
    out.push({ indice: i, claves: conocidos ? (conteo.get(i) ?? 0) : null, porDefecto: i === porDefecto })
  }
  return out
}

/** Lo que dice la fila de una base: su número con el prefijo de siempre (`db0`). */
export function etiquetaBaseClaves(indice: number): string {
  return `db${indice}`
}

/**
 * El nombre de una clave tal como se pinta (`pintarBytes`): el texto si es UTF-8 válido; si
 * no, los bytes escapados. Solo para ENSEÑAR: la identidad es el base64.
 */
export function nombreClave(b: DbKvBytes): string {
  return pintarBytes(b)
}

// --- El recorrido ------------------------------------------------------------------------

/** Una clave como la guarda el árbol: con su nombre PINTADO ya calculado. */
export interface ClaveVista {
  clave: DbKvClave
  nombre: string
}

/**
 * Lo recorrido de una base. Los tres primeros campos tienen la forma (y el orden) de una
 * `DbKvPaginaClaves`; los opcionales NO se escriben con su valor por omisión, así que el
 * recorrido de una sola página sin patrón se serializa como la propia página.
 */
export interface RecorridoClaves {
  /** El cursor de la vuelta siguiente; '0' = se recorrió todo. */
  cursor: string
  /** Las claves vistas, sin repetir, en el orden en que llegaron. */
  claves: ClaveVista[]
  /** Lo que tardaron todas las vueltas. */
  ms: number
  /** El MATCH con el que se recorrió (ausente = sin patrón). */
  patron?: string
  /** Vueltas SEGUIDAS sin ninguna clave nueva (ausente = 0). */
  vueltasVacias?: number
  /** «Cargar más» falló: lo ya cargado se queda y esto se enseña con su «Reintentar». */
  errorMas?: DbErrorSql
}

/**
 * Suma una página al recorrido (o empieza uno): sin repetir claves (por su base64) y con el
 * nombre pintado calculado aquí, una vez. Devuelve cuántas claves NUEVAS trajo.
 */
export function acumularPagina(
  previo: RecorridoClaves | null,
  pagina: DbKvPaginaClaves,
  patron: string
): { recorrido: RecorridoClaves; nuevas: number } {
  const claves = previo ? [...previo.claves] : []
  const vistas = new Set(claves.map((k) => k.clave.nombre.base64))
  let nuevas = 0
  for (const k of pagina.claves) {
    if (vistas.has(k.nombre.base64)) continue
    vistas.add(k.nombre.base64)
    claves.push({ clave: k, nombre: pintarBytes(k.nombre) })
    nuevas++
  }
  const recorrido: RecorridoClaves = { cursor: pagina.cursor, claves, ms: (previo?.ms ?? 0) + pagina.ms }
  if (patron !== '') recorrido.patron = patron
  // Recorrido acabado: las vueltas vacías ya no dicen nada (y así una sola página vacía se
  // serializa como la propia página).
  const vacias = nuevas === 0 && pagina.cursor !== '0' ? (previo?.vueltasVacias ?? 0) + 1 : 0
  if (vacias > 0) recorrido.vueltasVacias = vacias
  return { recorrido, nuevas }
}

/**
 * Un CLIC del recorrido: pide vueltas de SCAN desde el cursor de `previo` (o desde '0') hasta
 * que llegue alguna clave nueva, el cursor vuelva a '0' o se agoten `maxVueltas` (#6).
 * - Sin `previo` (la primera carga), un fallo es el error de la carga (la fila de error).
 * - Con `previo` («Cargar más»), un fallo NO tira lo cargado: vuelve el recorrido con
 *   `errorMas`, y la fila de «Cargar más» lo enseña con su «Reintentar».
 * `escanear` puede lanzar (el IPC): se trata como un fallo 'interno'.
 */
export async function recorrerClaves(
  escanear: (cursor: string) => Promise<DbRespuesta<DbKvPaginaClaves>>,
  previo: RecorridoClaves | null,
  patron: string,
  maxVueltas: number = VUELTAS_POR_CLIC
): Promise<DbRespuesta<RecorridoClaves>> {
  if (previo !== null && previo.cursor === '0') return { ok: true, valor: previo }
  // Lo que se arrastra del clic anterior NO es el error (se reintenta ahora).
  let acc: RecorridoClaves | null = previo === null ? null : sinErrorMas(previo)
  let cursor = previo?.cursor ?? '0'
  for (let vuelta = 0; vuelta < Math.max(1, maxVueltas); vuelta++) {
    let r: DbRespuesta<DbKvPaginaClaves>
    try {
      r = await escanear(cursor)
    } catch (err) {
      r = { ok: false, error: { motivo: 'interno', mensaje: err instanceof Error ? err.message : String(err) } }
    }
    if (!r.ok) {
      if (previo === null) return { ok: false, error: r.error }
      return { ok: true, valor: { ...(acc ?? previo), errorMas: r.error } }
    }
    const { recorrido, nuevas } = acumularPagina(acc, r.valor, patron)
    acc = recorrido
    cursor = recorrido.cursor
    if (nuevas > 0 || cursor === '0') break
  }
  // `acc` no puede ser null aquí: el bucle da al menos una vuelta y, si falla, ya volvió.
  return { ok: true, valor: acc as RecorridoClaves }
}

function sinErrorMas(r: RecorridoClaves): RecorridoClaves {
  if (r.errorMas === undefined) return r
  const copia: RecorridoClaves = { ...r }
  delete copia.errorMas
  return copia
}

/** Un texto LITERAL dentro de un MATCH: escapa los metacaracteres del glob (`\ * ? [ ]`). */
export function escaparGlob(literal: string): string {
  return literal.replace(/[\\*?[\]]/g, (c) => '\\' + c)
}

/**
 * El MATCH de lo que se escribe en «Filtrar claves…»: '' sin filtro; con comodines de Redis
 * (`*`, `?`, `[`) tal cual; sin ellos, el texto en cualquier parte del nombre (`*texto*`,
 * con la barra escapada para que el servidor no la lea como escape).
 */
export function patronDeFiltro(escrito: string): string {
  const t = escrito.trim()
  if (t === '') return ''
  if (/[*?[]/.test(t)) return t
  return `*${t.replace(/\\/g, '\\\\')}*`
}

// --- Las carpetas ------------------------------------------------------------------------

/** Una carpeta del árbol de claves (el prefijo común hasta un `:`). */
export interface CarpetaClaves {
  /** El trozo de ESTA carpeta (`perfil`), sin el separador. */
  nombre: string
  /** El prefijo entero con su separador (`usuario:1:`); '' en la raíz. */
  prefijo: string
  carpetas: CarpetaClaves[]
  claves: ClaveVista[]
  /** Cuántas claves CARGADAS hay dentro, en cualquier nivel. */
  total: number
}

const COLADOR = new Intl.Collator('es', { numeric: true })

interface CarpetaEnObra {
  nombre: string
  prefijo: string
  hijas: Map<string, CarpetaEnObra>
  claves: ClaveVista[]
}

function cerrarCarpeta(c: CarpetaEnObra): CarpetaClaves {
  const carpetas = [...c.hijas.values()].map(cerrarCarpeta).sort((a, b) => COLADOR.compare(a.nombre, b.nombre))
  const claves = [...c.claves].sort((a, b) => COLADOR.compare(a.nombre, b.nombre))
  let total = claves.length
  for (const h of carpetas) total += h.total
  return { nombre: c.nombre, prefijo: c.prefijo, carpetas, claves, total }
}

/** Agrupa las claves por `separador` (ver el ADR). Pura; no mira el cursor. */
export function agruparClaves(claves: readonly ClaveVista[], separador: string = SEPARADOR_CARPETAS): CarpetaClaves {
  const raiz: CarpetaEnObra = { nombre: '', prefijo: '', hijas: new Map(), claves: [] }
  for (const k of claves) {
    const trozos = k.nombre.split(separador)
    let actual = raiz
    for (let i = 0; i < trozos.length - 1; i++) {
      let hija = actual.hijas.get(trozos[i])
      if (!hija) {
        hija = { nombre: trozos[i], prefijo: actual.prefijo + trozos[i] + separador, hijas: new Map(), claves: [] }
        actual.hijas.set(trozos[i], hija)
      }
      actual = hija
    }
    actual.claves.push(k)
  }
  return cerrarCarpeta(raiz)
}

const MEMO_CARPETAS = new WeakMap<RecorridoClaves, CarpetaClaves>()

/** `agruparClaves` de un recorrido, calculada UNA vez por recorrido (es inmutable). */
export function carpetasDeRecorrido(r: RecorridoClaves): CarpetaClaves {
  let c = MEMO_CARPETAS.get(r)
  if (!c) {
    c = agruparClaves(r.claves)
    MEMO_CARPETAS.set(r, c)
  }
  return c
}

/**
 * Los prefijos de las carpetas que llevan hasta una clave, de fuera adentro
 * (`usuario:1:perfil` -> `usuario:`, `usuario:1:`): los nodos que «Mostrar en el árbol»
 * despliega. Del nombre PINTADO, como las carpetas.
 */
export function prefijosDeClave(nombre: string, separador: string = SEPARADOR_CARPETAS): string[] {
  const trozos = nombre.split(separador)
  const out: string[] = []
  let p = ''
  for (let i = 0; i < trozos.length - 1; i++) {
    p += trozos[i] + separador
    out.push(p)
  }
  return out
}

/** El nombre de una carpeta tal como se pinta: un trozo vacío (`a::b`) se ve como `""`. */
export function etiquetaCarpetaClaves(nombre: string): string {
  return nombre === '' ? '""' : nombre
}

// --- La fila de «Cargar más» ---------------------------------------------------------------

/** Lo que pinta la fila de «Cargar más claves» de una base. */
export interface VistaCargarMas {
  /** El botón: cargar más, seguir buscando o reintentar. */
  accion: string
  /** La frase de al lado (cuántas van, las vueltas vacías, el error), o null. */
  nota: string | null
  /** La nota es un error. */
  error: boolean
}

/** El texto de la fila de «Cargar más» según el recorrido (ver el ADR). */
export function vistaCargarMas(r: RecorridoClaves, cargando: boolean): VistaCargarMas {
  if (cargando) return { accion: TEXTOS_CLAVES.cargando, nota: null, error: false }
  if (r.errorMas !== undefined) {
    return { accion: TEXTOS_CLAVES.reintentar, nota: `No se pudieron cargar más: ${r.errorMas.mensaje}`, error: true }
  }
  const n = r.claves.length
  if (n === 0) {
    const v = r.vueltasVacias ?? 0
    return {
      accion: TEXTOS_CLAVES.seguirBuscando,
      nota: `Ninguna todavía${v > 0 ? ` tras ${v} ${v === 1 ? 'vuelta' : 'vueltas'}` : ''}`,
      error: false
    }
  }
  return { accion: TEXTOS_CLAVES.cargarMas, nota: `${n.toLocaleString('es-ES')} cargadas`, error: false }
}
