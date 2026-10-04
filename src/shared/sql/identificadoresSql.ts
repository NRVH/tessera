// =============================================================================
// Identificadores: plegado según la caja del motor, citado (si el nombre no es «seguro» o es reservada)
// y `ESQUEMA.OBJETO` con cada parte citada. SQLite y SQL Server no pliegan y comparan con `claveDeNombre`;
// SQL Server escribe corchetes, y `citar(n)` sin dialecto da `"x"`. Neutral y ES2020.
// Decisiones: docs/decisiones/bd/sql-dialectos-como-tabla.md
// =============================================================================

import { deDialecto, reglasDe, type DialectoSql, type ReglasDialecto } from './dialectosSql.ts'
import { RESERVADAS } from './palabrasSql.ts'
import { nunca } from '../nunca.ts'

/**
 * La forma "segura" de cada dialecto: la que el servidor devuelve igual sin comillas.
 * Un `Record` y no un binario sobre el nombre del dialecto: uno nuevo no compila hasta que
 * dé la suya, en vez de heredar en silencio la de PG.
 */
const SEGURO: Readonly<Record<DialectoSql, RegExp>> = {
  oracle: /^[A-Z][A-Z0-9_$#]*$/,
  postgres: /^[a-z_][a-z0-9_$]*$/,
  // SQLite conserva la caja (`cajaSinComillas: 'insensible'`): cualquier caja ASCII es
  // segura; el `$` vale detrás de la primera letra. Fuera de ASCII, se cita.
  sqlite: /^[A-Za-z_][A-Za-z0-9_$]*$/,
  // SQL Server: el «identificador regular» de T-SQL en ASCII: letra o `_` al
  // principio (`@` y `#` iniciales son variables y temporales: se citan) y detrás letras,
  // dígitos, `_`, `@`, `$` y `#`. Conserva la caja, como SQLite. Fuera de ASCII, se cita.
  sqlserver: /^[A-Za-z_][A-Za-z0-9_@$#]*$/
}

/** Pliega un identificador escrito SIN comillas como lo guardaría el motor. */
export function plegarSinComillas(crudo: string, d: DialectoSql): string {
  const caja = reglasDe(d).cajaSinComillas
  switch (caja) {
    case 'mayus':
      return crudo.toUpperCase()
    case 'minus':
      return crudo.replace(/[A-Z]+/g, (m) => m.toLowerCase())
    case 'insensible':
    case 'insensibleUnicode':
      // No se pliega: el motor guarda el nombre como se escribió y COMPARA sin caja (ASCII en
      // SQLite, toda letra en SQL Server). Quien busque en el catálogo compara con
      // `claveDeNombre`.
      return crudo
    default:
      return nunca(caja, 'plegarSinComillas')
  }
}

/**
 * El nombre de catálogo de un identificador tal como está escrito en el SQL: si
 * va entre comillas, su contenido exacto (`""` -> `"`); si no, plegado.
 */
export function normalizarIdent(crudo: string, d: DialectoSql): string {
  const r = reglasDe(d) // valida también cuando el nombre va citado y no llega a plegarse
  const t = crudo.trim()
  return sinComillasDobles(t) ?? sinCorchetes(t, r) ?? sinAcentoGrave(t, r) ?? plegarSinComillas(t, d)
}

/** `"x"` y `U&"x"` (PG): el contenido con `""` -> `"`; null si no va así. */
function sinComillasDobles(t: string): string | null {
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1).split('""').join('"')
  if (/^[uU]&"/.test(t) && t[t.length - 1] === '"') return t.slice(3, -1).split('""').join('"')
  return null
}

/**
 * `[x]` de SQLite (sin escape dentro, como lo lee el léxico) y de SQL Server (`corcheteEscapeDoble`:
 * `]]` dentro es un `]`, y un `]` suelto no es un nombre citado); null si no va así.
 */
function sinCorchetes(t: string, r: ReglasDialecto): string | null {
  if (!(r.identCorchetes && t.length >= 2 && t[0] === '[' && t[t.length - 1] === ']')) return null
  const dentro = t.slice(1, -1)
  if (r.corcheteEscapeDoble) return dentro.split(']]').join('').indexOf(']') < 0 ? dentro.split(']]').join(']') : null
  return dentro.indexOf(']') < 0 ? dentro : null
}

/** `` `x` `` de SQLite (con `` `` `` como escape); null si no va así. */
function sinAcentoGrave(t: string, r: ReglasDialecto): string | null {
  if (r.identAcentoGrave && t.length >= 2 && t[0] === '`' && t[t.length - 1] === '`') return t.slice(1, -1).split('``').join('`')
  return null
}

/**
 * La CLAVE con la que el motor compara dos nombres de catálogo ya normalizados (los de
 * `normalizarIdent` o los que da el catálogo): dos nombres son el mismo objeto si tienen la
 * misma clave. En Oracle y PG, el propio nombre (ya viene plegado; la comparación es
 * exacta). Con 'insensible' (SQLite) el motor compara sin caja ASCII, TAMBIÉN entre comillas
 * (`"Clientes"` y `clientes` son la misma tabla; medido): las A-Z pasan a minúsculas y lo no
 * ASCII se queda como está (`sqlite3StrICmp` solo pliega ASCII: `Ñ` y `ñ` son distintas).
 */
export function claveDeNombre(nombre: string, d: DialectoSql): string {
  const caja = reglasDe(d).cajaSinComillas
  switch (caja) {
    case 'mayus':
    case 'minus':
      return nombre
    case 'insensible':
      return nombre.replace(/[A-Z]+/g, (m) => m.toLowerCase())
    case 'insensibleUnicode':
      // SQL Server con su intercalación por defecto (_CI_AS), medido en 2022: `Ñandú` y
      // `ñANDÚ` son la misma tabla, `É` = `é`, pero `cafe` ≠ `café` (distingue acentos).
      // `toLowerCase` pliega toda letra y no toca los acentos. Límites medidos: el servidor
      // da `ß` = `SS` (aquí distintos) e `ı` ≠ `I` (aquí distintos también: bien). Con una
      // intercalación _CS_ el servidor distingue caja y esto confundiría dos nombres; es rara
      // en bases de usuario y se deja escrita.
      return nombre.toLowerCase()
    default:
      return nunca(caja, 'claveDeNombre')
  }
}

/** ¿Son el mismo objeto para el motor? (ver `claveDeNombre`). */
export function mismoNombre(a: string, b: string, d: DialectoSql): boolean {
  return claveDeNombre(a, d) === claveDeNombre(b, d)
}

/**
 * Cita SIEMPRE, duplicando las comillas internas. Con el dialecto, cita como ESE motor: en SQL
 * Server (`corcheteEscapeDoble`) entre corchetes, con `]` doblado (`[a]]b]`), porque `"x"` solo
 * es un nombre con QUOTED_IDENTIFIER ON y el `sqlcmd` de ODBC lo abre en OFF (medido: su
 * SESSIONPROPERTY da 0), así que un guion exportado con `"x"` no correría allí. Sin dialecto,
 * o en los demás, `"x"` como siempre.
 */
export function citar(nombre: string, d?: DialectoSql): string {
  if (d !== undefined && reglasDe(d).corcheteEscapeDoble) return '[' + nombre.split(']').join(']]') + ']'
  return '"' + nombre.split('"').join('""') + '"'
}

/** Cita solo si el nombre no se leería igual sin comillas en el motor `d`. */
export function citarSiHaceFalta(nombre: string, d: DialectoSql): string {
  const seguro = deDialecto(SEGURO, d)
  if (seguro.test(nombre) && !deDialecto(RESERVADAS, d).has(nombre.toUpperCase())) return nombre
  return citar(nombre, d)
}

/**
 * `ESQUEMA.OBJETO` con cada parte citada si hace falta (o siempre, con
 * `siempre: true`). Sin esquema, solo el objeto.
 */
export function nombreCalificado(
  esquema: string | null | undefined,
  nombre: string,
  d: DialectoSql,
  opciones: { siempre?: boolean } = {}
): string {
  reglasDe(d) // valida también con `siempre`
  const c = (n: string): string => (opciones.siempre ? citar(n, d) : citarSiHaceFalta(n, d))
  return esquema ? c(esquema) + '.' + c(nombre) : c(nombre)
}
