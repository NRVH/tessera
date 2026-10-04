// =============================================================================
// Parámetros de una sentencia de consola -> los binds que viajan al trabajador. El main es la
// autoridad: vuelve a sacar los parámetros del texto que se ENVÍA, rechaza si falta alguno y
// manda SOLO los usados. La forma la decide el estilo de parámetros del dialecto (Oracle por
// clave, PG posicional con tope, SQLite mixto), en un `switch` que cierra con `nunca`.
// Decisiones: docs/decisiones/bd/sesiones-por-motor.md
// =============================================================================

import type { DbBinds } from '../../../shared/db-explorador-ipc.ts'
import { etiquetaMotor } from '../../../shared/motores/index.ts'
import { nunca } from '../../../shared/nunca.ts'
import { reglasDe, type DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import { parametrosQueFaltan, type ParametroSql } from '../../../shared/sql/parametrosSql.ts'
import { tokenizar } from '../../../shared/sql/lexicoSql.ts'
import type { BindsSqlite } from './protocoloTrabajador.ts'

/** Parámetros distintos por sentencia (y claves en una petición): más es un error. */
export const MAX_BINDS = 1000
/** Longitud máxima de una clave (Oracle 128; PG `$n`). */
export const MAX_CLAVE_BIND = 200
/** Suma de las longitudes de los valores (unidades UTF-16): lo mismo que una consola. */
export const MAX_TEXTO_BINDS = 5 * 1024 * 1024
/** El `$n` más alto que admite PG: el mensaje Bind lleva el número de parámetros en 16 bits. */
const MAX_POSICION_PG = 65535

/** Binds tal como los recibe el trabajador (`BindsTrabajador`, sin las salidas de texto). */
export type BindsSalientes = Record<string, string | null> | Array<string | null> | BindsSqlite

export type ValidacionBinds = { ok: true; binds: DbBinds | undefined } | { ok: false; mensaje: string }

/**
 * Valida la FORMA de `binds` tal como llega del renderer: ausente, o un objeto plano
 * de claves cortas con valores texto o null, con topes de número y tamaño.
 */
export function validarBinds(v: unknown): ValidacionBinds {
  if (v === undefined || v === null) return { ok: true, binds: undefined }
  if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, mensaje: 'Los parámetros no tienen la forma esperada.' }
  const claves = Object.keys(v)
  if (claves.length > MAX_BINDS) return { ok: false, mensaje: `Demasiados parámetros (más de ${MAX_BINDS}).` }
  const binds: DbBinds = {}
  let total = 0
  for (const k of claves) {
    const valor = (v as Record<string, unknown>)[k]
    if (k.length === 0 || k.length > MAX_CLAVE_BIND) return { ok: false, mensaje: 'Un parámetro tiene un nombre no válido.' }
    if (valor !== null && typeof valor !== 'string') {
      return { ok: false, mensaje: `El valor de «${k}» tiene que ser texto o NULL.` }
    }
    total += valor === null ? 0 : valor.length
    if (total > MAX_TEXTO_BINDS) return { ok: false, mensaje: 'Los valores de los parámetros son demasiado grandes.' }
    binds[k] = valor
  }
  return { ok: true, binds }
}

/**
 * La clave con la que node-oracledb casa el parámetro (ver la cabecera): la del
 * contrato si es un nombre que Oracle escribiría sin comillas (MAYÚSCULAS, o un
 * número); si no, CON comillas.
 */
export function claveOracle(clave: string): string {
  if (/^\d+$/.test(clave)) return clave
  if (/^[\p{L}][\p{L}\p{N}_$#]*$/u.test(clave) && clave === clave.toUpperCase()) return clave
  return `"${clave}"`
}

/** Mensaje de `parametros` para las claves que faltan, escritas como en la sentencia. */
export function mensajeFaltan(params: readonly ParametroSql[], faltan: readonly string[]): string {
  const escritos = faltan.map((k) => params.find((p) => p.clave === k)?.texto ?? k)
  return escritos.length === 1
    ? `Falta el valor del parámetro ${escritos[0]}.`
    : `Faltan los valores de los parámetros ${escritos.join(', ')}.`
}

export type BindsResueltos =
  /** `aviso`: algo que decir con el resultado sin dejar de enviar (SQLite, `avisoChoquesSqlite`). */
  | { ok: true; binds: BindsSalientes | undefined; aviso?: string }
  | { ok: false; faltan: string[]; mensaje: string }

/**
 * Los binds para el trabajador: SOLO los parámetros que usa la sentencia, en la forma
 * de su motor. `rellenar`: los que falten van como NULL en vez de rechazar (el EXPLAIN
 * de Oracle en thin, ver la cabecera). Sin parámetros, `binds: undefined`. `texto`: la
 * sentencia de la que salieron `params`; la necesita SQLite ('sqliteMixto'), cuyos binds
 * dependen del ORDEN y la forma exacta de cada marcador (`disposicionSqlite`).
 */
export function bindsParaTrabajador(
  params: readonly ParametroSql[],
  binds: DbBinds | undefined,
  d: DialectoSql,
  rellenar = false,
  texto?: string
): BindsResueltos {
  if (params.length === 0) return { ok: true, binds: undefined }
  if (!rellenar) {
    const faltan = parametrosQueFaltan(params, binds)
    if (faltan.length > 0) return { ok: false, faltan, mensaje: mensajeFaltan(params, faltan) }
  }
  const valorDe = (clave: string): string | null =>
    binds && Object.prototype.hasOwnProperty.call(binds, clave) ? binds[clave] : null
  const estilo = reglasDe(d).estiloParametros
  switch (estilo) {
    case 'dolarNumero':
      return bindsPosicionales(params, d, valorDe)
    case 'dosPuntosNombre': {
      const obj: Record<string, string | null> = {}
      for (const p of params) obj[claveOracle(p.clave)] = valorDe(p.clave)
      return { ok: true, binds: obj }
    }
    case 'sqliteMixto':
      return bindsSqliteMixtos(texto, d, valorDe)
    case 'ninguno':
      // SQL Server: el dialecto no tiene parámetros del usuario (`parametrosSql` da [] y se
      // salió arriba); si llegara alguno, no hay forma de enlazarlo.
      return { ok: true, binds: undefined }
    default:
      return nunca(estilo, 'bindsParaTrabajador')
  }
}

/** PG: el array posicional, con el valor de `$k` en `k-1` y un hueco como NULL. */
function bindsPosicionales(
  params: readonly ParametroSql[],
  d: DialectoSql,
  valorDe: (clave: string) => string | null
): BindsResueltos {
  let n = 0
  for (const p of params) n = Math.max(n, Number(p.clave))
  // Antes de reservar nada: un `$1000000000` de más dejaba al main sin memoria. Sin `faltan`:
  // no hay valor que pedir.
  if (!(n <= MAX_POSICION_PG)) {
    const alto = params.find((p) => !(Number(p.clave) <= MAX_POSICION_PG))
    return { ok: false, faltan: [], mensaje: `${etiquetaMotor(d)} admite como mucho $${MAX_POSICION_PG}: ${alto?.texto ?? 'el parámetro'} no puede enviarse.` }
  }
  const arr: Array<string | null> = []
  for (let i = 1; i <= n; i++) arr.push(valorDe(String(i)))
  return { ok: true, binds: arr }
}

/**
 * SQLite: los nombres con su prefijo COMPLETO y los `?`/`?NNN` como anónimos, uno por índice
 * que no sea de un nombre. Hace falta el TEXTO: con solo las claves no se sabe qué índice toca.
 */
function bindsSqliteMixtos(texto: string | undefined, d: DialectoSql, valorDe: (clave: string) => string | null): BindsResueltos {
  if (texto === undefined) {
    return { ok: false, faltan: [], mensaje: 'Falta el texto de la sentencia para enlazar sus parámetros.' }
  }
  const disposicion = disposicionSqlite(texto, d)
  if (disposicion.mayor > MAX_INDICE_SQLITE) {
    return { ok: false, faltan: [], mensaje: `Como mucho ?${MAX_INDICE_SQLITE}: la sentencia usa un número de parámetro más alto.` }
  }
  const nombrados: Record<string, string | null> = {}
  for (const [nombre] of disposicion.nombres) nombrados[nombre] = valorDe(nombre.slice(1))
  const anonimos: Array<string | null> = []
  for (let i = 1; i <= disposicion.mayor; i++) {
    if (disposicion.indicesConNombre.has(i)) continue
    anonimos.push(valorDe(String(i)))
  }
  const aviso = avisoChoquesSqlite(disposicion.choques, d)
  return aviso === null ? { ok: true, binds: { nombrados, anonimos } } : { ok: true, binds: { nombrados, anonimos }, aviso }
}

/**
 * El tope de índice de parámetro de SQLite (`SQLITE_MAX_VARIABLE_NUMBER`, 32766 desde la
 * 3.32): uno más alto lo rechaza el propio SQLite, y aquí evita reservar un array enorme de
 * NULL por un `?1000000000` tecleado de más (lo mismo que el tope de `$n` de PG).
 */
const MAX_INDICE_SQLITE = 32766

/**
 * Cómo numera SQLite los parámetros de `texto` (la regla de `parametrosSql`, que también la
 * sigue): cada `?` a secas toma el mayor visto + 1; cada `?NNN`, el número NNN; cada nombre
 * con `:`/`@`/`$` NUEVO (por su texto: `:x` y `@x` son dos parámetros), el mayor + 1.
 * Devuelve los nombres con su índice, qué índices son de un nombre así y el mayor. Los
 * anónimos que manda `bindsParaTrabajador` son los índices 1…mayor que NO son de un nombre
 * con `:`/`@`/`$`: node:sqlite enlaza los anónimos por índice saltando esos (y solo esos:
 * un `?NNN` se enlaza como anónimo; medido), y un índice sin parámetro va como NULL.
 */
function disposicionSqlite(
  texto: string,
  d: DialectoSql
): { nombres: Map<string, number>; indicesConNombre: Set<number>; mayor: number; choques: Array<{ numero: string; nombre: string }> } {
  const nombres = new Map<string, number>()
  const indicesConNombre = new Set<number>()
  const choques: Array<{ numero: string; nombre: string }> = []
  let mayor = 0
  for (const t of tokenizar(texto, d)) {
    if (t.tipo !== 'bind' || t.sinCerrar) continue
    const v = t.valor
    if (v === '?') mayor += 1
    else if (/^\?\d+$/.test(v)) {
      const n = Number(v.slice(1))
      // Un `?NNN` DETRÁS de un nombre que ya tiene ese índice es el MISMO hueco (ver
      // `avisoChoquesSqlite`). Solo puede pasar así: un nombre nuevo toma siempre el mayor
      // visto + 1, así que nunca cae en el índice de un `?NNN` anterior.
      if (indicesConNombre.has(n)) {
        const nombre = [...nombres].find(([, i]) => i === n)?.[0]
        if (nombre !== undefined && !choques.some((c) => c.numero === v)) choques.push({ numero: v, nombre })
      }
      mayor = Math.max(mayor, n)
    } else if (/^[:@$]/.test(v) && !nombres.has(v)) {
      mayor += 1
      nombres.set(v, mayor)
      indicesConNombre.add(mayor)
    }
  }
  return { nombres, indicesConNombre, mayor, choques }
}

/**
 * El aviso de una sentencia de SQLite que usa un `?NNN` y un nombre (`:a`, `@a`, `$a`) con el
 * MISMO índice (`select :a, ?1`), o null. Para SQLite son UN solo
 * parámetro: el diálogo pide los dos valores (son dos claves), pero solo se enlaza el del
 * nombre (node:sqlite salta los índices de un nombre al enlazar los anónimos; medido), y el
 * del número se pierde en silencio. No se rechaza: la sentencia es SQL válido y hace lo que
 * SQLite dice; se AVISA con el resultado, que es lo que haría falta para no fiarse del valor
 * equivocado. La fija `test-binds-consola` (10) a través de `bindsParaTrabajador`.
 */
function avisoChoquesSqlite(choques: ReadonlyArray<{ numero: string; nombre: string }>, d: DialectoSql): string | null {
  if (choques.length === 0) return null
  // El nombre del motor, del registro (la guardia `test-motores-sueltos` no deja escribirlo aquí).
  const motor = etiquetaMotor(d)
  if (choques.length === 1) {
    const [c] = choques
    return `En ${motor}, ${c.numero} y ${c.nombre} son el MISMO parámetro: se usó el valor de ${c.nombre} y el de ${c.numero} no.`
  }
  const parejas = choques.map((c) => `${c.numero} y ${c.nombre}`).join('; ')
  return `En ${motor}, cada pareja es el MISMO parámetro (${parejas}): se usaron los valores de los nombres y los de los números no.`
}
