// =============================================================================
// Historial de consultas de la consola: lo que su popover decide sin DOM (cómo se escribe
// cada fila, el cursor con el teclado, qué tecla borra una entrada) y, sobre todo, qué se
// inserta en el editor al elegir una. El historial lo guarda el main, fuera del espacio de
// datos que ve el agente, y llega por `dbExplorador.historial`, más reciente primero.
// Decisiones: docs/decisiones/bd/ui-consola-historial.md
// =============================================================================

import type { DbEntradaHistorial } from '../../../../../shared/db-explorador-ipc.ts'
import type { Plataforma } from '../../../../../shared/plataforma.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { esAlcanceDeLote } from '../../../../../shared/sql/clasificarSql.ts'
import { dividirSentencias } from '../../../../../shared/sql/divisorSql.ts'
import { tokenizar } from '../../../../../shared/sql/lexicoSql.ts'
import { esAtajoBorrado, type TeclaBorrado } from '../../../util/atajos.ts'
import { formatoDuracion } from './marcasConsola.ts'
import { cantidad } from './salidaConsola.ts'

/** Lo que se enseña en lugar del alias de una conexión que ya no existe. */
export const TEXTO_CONEXION_BORRADA = '(conexión borrada)'

/** Entradas que se piden al main: bastantes para buscar de reojo, pocas para pintar sin lista virtual. */
export const LIMITE_HISTORIAL = 500

/** Largo máximo de la primera línea de una fila. */
export const MAX_PRIMERA_LINEA = 160

function dos(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** La hora de una entrada, según lo lejos que quede de `ahora` (hora local). */
export function horaHistorial(en: number, ahora: number): string {
  const d = new Date(en)
  const h = new Date(ahora)
  const hora = `${dos(d.getHours())}:${dos(d.getMinutes())}`
  const mismoDia = d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate()
  if (mismoDia) return `${hora}:${dos(d.getSeconds())}`
  const fecha = `${dos(d.getDate())}/${dos(d.getMonth() + 1)}`
  if (d.getFullYear() === h.getFullYear()) return `${fecha} ${hora}`
  return `${fecha}/${d.getFullYear()}`
}

/** La primera línea con texto del SQL, sin sangría, con « …» si sigue y recortada. */
export function primeraLineaSql(sql: string, max: number = MAX_PRIMERA_LINEA): string {
  const lineas = sql.split(/\r\n|\n|\r/)
  const i = lineas.findIndex((l) => l.trim() !== '')
  if (i < 0) return ''
  const sigue = lineas.slice(i + 1).some((l) => l.trim() !== '')
  const linea = lineas[i].trim() + (sigue ? ' …' : '')
  return linea.length <= max ? linea : `${linea.slice(0, max - 1)}…`
}

/** El alias de la conexión de una entrada, o «(conexión borrada)». */
export function aliasHistorial(conexionId: string, aliasPorId: ReadonlyMap<string, string>): string {
  return aliasPorId.get(conexionId) ?? TEXTO_CONEXION_BORRADA
}

/** El glifo del resultado: el mismo vocabulario que el margen del editor. */
export function glifoHistorial(r: DbEntradaHistorial['resultado']): { simbolo: string; clase: string; etiqueta: string } {
  switch (r) {
    case 'ok':
      return { simbolo: '✓', clase: 'ok', etiqueta: 'Correcta' }
    case 'error':
      return { simbolo: '✗', clase: 'error', etiqueta: 'Con error' }
    case 'cancelada':
      return { simbolo: '⊘', clase: 'cancelada', etiqueta: 'Cancelada' }
  }
}

/** Tooltip de una fila: el SQL entero y, debajo, lo que pasó. */
export function detalleHistorial(e: DbEntradaHistorial, alias: string): string {
  const partes = [glifoHistorial(e.resultado).etiqueta, formatoDuracion(e.ms)]
  if (typeof e.filas === 'number') partes.push(cantidad(e.filas, 'fila', 'filas'))
  partes.push(e.esquema ? `${alias} · ${e.esquema}` : alias)
  return `${e.sql}\n\n${partes.join(' · ')}`
}

/** Lo que hay alrededor del cursor en SU línea. */
export interface ContextoCursor {
  /** Texto de la línea ANTES del cursor. */
  antes: string
  /** Texto de la línea DESPUÉS del cursor. */
  despues: string
}

/** Lo que se inserta y dónde queda el cursor (offset dentro de `texto`). */
export interface Insercion {
  texto: string
  cursor: number
}

/**
 * El texto que se inserta al elegir una entrada (INSERTA, no sustituye): en su propia línea
 * si el cursor tiene texto a los lados, y TERMINADA según lo que diga el divisor. El
 * cursor queda detrás del terminador. `eol` es el fin de línea del MODELO donde se
 * inserta (`getEOL()`): los saltos salen en él y el cursor se cuenta sobre ellos.
 */
export function insercionHistorial(
  sql: string,
  dialecto: DialectoSql,
  ctx: ContextoCursor,
  eol: '\n' | '\r\n' = '\n'
): Insercion {
  const cuerpo = sql.replace(/^\s+|\s+$/g, '')
  let terminador = ''
  const ss = dividirSentencias(cuerpo, dialecto)
  const ultima = ss.length > 0 ? ss[ss.length - 1] : null
  if (ultima && ultima.terminador === 'finDeTexto') {
    if (ultima.plsql) terminador = '\n/'
    // Una unidad de ALCANCE DE LOTE de SQL Server (DECLARE, IF, BEGIN,
    // CREATE PROCEDURE…) no la cierra un `;`: llega hasta el GO. Con `;` la sentencia de
    // debajo se le uniría; con `GO` en su línea queda cerrada, como la `/` del PL/SQL.
    else if (esAlcanceDeLote(tokenizar(ultima.texto, dialecto), dialecto)) terminador = '\nGO'
    else terminador = ';'
  }
  const prefijo = ctx.antes.trim() !== '' ? '\n' : ''
  const sufijo = ctx.despues.trim() !== '' ? '\n' : ''
  // Los saltos, en el fin de línea del MODELO: Monaco reescribe los de lo insertado al
  // suyo y el cursor se contaría corto o largo una posición por salto. Normalizar `central` y
  // el sufijo por separado da lo mismo que todo junto: `central` nunca acaba en `\r`
  // (el cuerpo va recortado y el terminador es `;`, `/` o `GO`).
  const aEol = (t: string): string => t.replace(/\r\n|\r|\n/g, eol)
  const central = aEol(prefijo + cuerpo + terminador)
  return { texto: central + aEol(sufijo), cursor: central.length }
}

/**
 * La consulta al main que corresponde a unos controles, en una clave comparable: con
 * ella se sabe si la lista que se ve es la de lo que hay tecleado. El filtro va
 * recortado, como se manda.
 */
export function consultaHistorial(soloEsta: boolean, filtro: string): string {
  return JSON.stringify([soloEsta, filtro.trim()])
}

/** Qué hace Enter en el historial (ver `enterEnHistorial`). */
export type AccionEnterHistorial = 'insertar' | 'esperar' | 'nada'

/**
 * ¿Qué hace Enter? `vista` es la consulta con la que llegó la lista que se ve (null si
 * aún no llegó ninguna) y `actual`, la de lo que hay en los controles.
 *
 * Si no son la misma, la lista es VIEJA: el filtro se aplica en el main tras 150 ms de
 * pausa, y quien teclea «emp» y da Enter en seguida insertaba la fila activa de la lista
 * anterior, que puede no casar con lo escrito. Entonces se ESPERA a la lista nueva y se
 * inserta su primera fila, que es lo que habría elegido Enter si hubiera llegado a
 * tiempo (seguir tecleando retira la espera: ver `HistorialConsultas`). Ignorar el Enter
 * sin más no sirve: el usuario no ve por qué no pasó nada y lo repite.
 */
export function enterEnHistorial(vista: string | null, actual: string, total: number): AccionEnterHistorial {
  if (vista !== actual) return 'esperar'
  return total > 0 ? 'insertar' : 'nada'
}

/** Filas que salta Re Pág / Av Pág. */
export const PAGINA_HISTORIAL = 10

/**
 * El cursor de la lista tras una tecla, o null si la tecla no es de moverse. Acotado a
 * la lista; con la lista vacía, 0.
 */
export function moverEnHistorial(actual: number, total: number, tecla: string): number | null {
  if (total <= 0) return tecla === 'ArrowDown' || tecla === 'ArrowUp' ? 0 : null
  const acotar = (n: number): number => Math.max(0, Math.min(total - 1, n))
  switch (tecla) {
    case 'ArrowDown':
      return acotar(actual + 1)
    case 'ArrowUp':
      return acotar(actual - 1)
    case 'PageDown':
      return acotar(actual + PAGINA_HISTORIAL)
    case 'PageUp':
      return acotar(actual - PAGINA_HISTORIAL)
    default:
      return null
  }
}

/** Lo que hace falta de un evento para decidir si borra la entrada activa. */
export interface TeclaBorrarEntrada extends TeclaBorrado {
  readonly repeat?: boolean
}

/**
 * ¿Esta tecla BORRA la entrada activa? Solo con el filtro vacío, sin autorrepetición,
 * y nunca el ⌫ pelado: quien vacía el filtro a golpe de ⌫ daría uno de más y se llevaría
 * una entrada. Supr en Windows y Linux; ⌘⌫ (y fn+⌫, que es Supr) en Mac.
 */
export function esBorrarEntrada(e: TeclaBorrarEntrada, filtroVacio: boolean, plataforma: Plataforma): boolean {
  if (!filtroVacio || e.repeat === true) return false
  if (!esAtajoBorrado(e, plataforma)) return false
  return !(e.key === 'Backspace' && !e.ctrlKey && !e.metaKey)
}

/** La pregunta de «Borrar todo». */
export const TEXTO_BORRAR_TODO =
  '¿Borrar TODO el historial de consultas de este perfil? Incluye el de todas sus conexiones y no se puede deshacer.'
