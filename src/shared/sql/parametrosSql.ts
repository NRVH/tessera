// =============================================================================
// Parámetros de una sentencia que el usuario rellena antes de ejecutar (`:x` de Oracle, `$1` de PG, los
// de SQLite; ninguno en SQL Server). Los usan el diálogo (renderer) y el main, que vuelve a extraerlos y
// rechaza si falta alguno. Se apoya en el léxico; la clave y el orden salen de `estiloParametros`.
// No son parámetros el CREATE de una unidad PL/SQL ni los `$n` de un PREPARE. Puro, neutral y ES2020.
// =============================================================================

import { reglasDe, type DialectoSql, type EstiloParametros } from './dialectosSql.ts'
import { esSignificativo, tokenizar, type Token } from './lexicoSql.ts'
import { nunca } from '../nunca.ts'

export interface ParametroSql {
  /** La clave de `DbBinds`: `ID`, `Id` (citado), `1`. */
  clave: string
  /** Cómo está escrito la PRIMERA vez (`:id`, `$1`): para enseñarlo en el diálogo. */
  texto: string
  /** Dónde aparece, en offsets UTF-16 del texto recibido (para marcarlo). */
  apariciones: Array<{ desde: number; hasta: number }>
}

const UNIDAD_PLSQL = new Set(['TRIGGER', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'TYPE'])
const MODIFICADORES = new Set(['OR', 'REPLACE', 'EDITIONABLE', 'NONEDITIONABLE', 'EDITIONING'])

/** ¿Los tokens empiezan por `CREATE [OR REPLACE] [EDITIONABLE…] <unidad de PL/SQL>`? */
function esCreateDeUnidad(tokens: readonly Token[]): boolean {
  const sig = tokens.filter(esSignificativo)
  if (sig.length < 2 || sig[0].tipo !== 'palabra' || sig[0].valor !== 'CREATE') return false
  for (let i = 1; i < sig.length && i < 6; i++) {
    const t = sig[i]
    if (t.tipo !== 'palabra') return false
    if (UNIDAD_PLSQL.has(t.valor)) return true
    if (!MODIFICADORES.has(t.valor)) return false
  }
  return false
}

/** PG: ¿`PREPARE …` o `CREATE [OR REPLACE] FUNCTION|PROCEDURE …`? Sus `$n` no son del usuario. */
function esSinParametrosPg(tokens: readonly Token[]): boolean {
  const sig = tokens.filter(esSignificativo)
  if (sig.length < 2 || sig[0].tipo !== 'palabra') return false
  if (sig[0].valor === 'PREPARE') return true
  if (sig[0].valor !== 'CREATE') return false
  let i = 1
  if (sig[i].tipo === 'palabra' && sig[i].valor === 'OR' && sig[i + 1]?.tipo === 'palabra' && sig[i + 1].valor === 'REPLACE') i += 2
  const t = sig[i]
  return t !== undefined && t.tipo === 'palabra' && (t.valor === 'FUNCTION' || t.valor === 'PROCEDURE')
}

/** La clave de un token `bind` según el dialecto (ver la cabecera). */
export function claveDeBind(crudo: string, d: DialectoSql): string {
  const estilo = reglasDe(d).estiloParametros
  switch (estilo) {
    case 'dolarNumero': {
      const n = crudo.startsWith('$') ? crudo.slice(1) : crudo
      // `$01` es `$1` para PG: sin los ceros de la izquierda (texto, no Number: `$99…9` no se redondea).
      return /^\d+$/.test(n) ? n.replace(/^0+(?=\d)/, '') : n
    }
    case 'dosPuntosNombre': {
      const sinPrefijo = crudo.startsWith(':') ? crudo.slice(1) : crudo
      if (sinPrefijo.length >= 2 && sinPrefijo[0] === '"' && sinPrefijo[sinPrefijo.length - 1] === '"') {
        return sinPrefijo.slice(1, -1).split('""').join('"')
      }
      return sinPrefijo.toUpperCase()
    }
    case 'sqliteMixto': {
      // `?NNN` → el número (sin ceros a la izquierda); `?` a secas → '' (su número depende
      // del ORDEN y lo pone `parametrosSqlite`); `:x`, `@x`, `$x` → el nombre sin prefijo,
      // con su caja (ver `EstiloParametros`).
      if (/^\?\d+$/.test(crudo)) return crudo.slice(1).replace(/^0+(?=\d)/, '')
      if (crudo === '?') return ''
      return /^[:@$]/.test(crudo) ? crudo.slice(1) : crudo
    }
    case 'ninguno':
      // SQL Server: el dialecto no tiene parámetros del usuario (`@x` es una variable) y el
      // léxico no emite ningún bind; si alguien pidiera la clave de uno, es su texto.
      return crudo
    default:
      return nunca(estilo, 'claveDeBind')
  }
}

/** ¿Los parámetros de esta sentencia son de ELLA y no del usuario? (ver la cabecera) */
function sinParametrosDelUsuario(tokens: readonly Token[], estilo: EstiloParametros): boolean {
  switch (estilo) {
    case 'dosPuntosNombre':
      return esCreateDeUnidad(tokens)
    case 'dolarNumero':
      return esSinParametrosPg(tokens)
    case 'sqliteMixto':
      return esCreateTriggerSqlite(tokens)
    case 'ninguno':
      // SQL Server: ninguna sentencia tiene parámetros del usuario (ver `EstiloParametros`).
      return true
    default:
      return nunca(estilo, 'sinParametrosDelUsuario')
  }
}

/** SQLite: ¿`CREATE [TEMP|TEMPORARY] TRIGGER …`? Su cuerpo no lleva parámetros del usuario. */
function esCreateTriggerSqlite(tokens: readonly Token[]): boolean {
  const sig = tokens.filter(esSignificativo)
  if (sig.length < 2 || sig[0].tipo !== 'palabra' || sig[0].valor !== 'CREATE') return false
  let i = 1
  if (sig[i].tipo === 'palabra' && (sig[i].valor === 'TEMP' || sig[i].valor === 'TEMPORARY')) i++
  const t = sig[i]
  return t !== undefined && t.tipo === 'palabra' && t.valor === 'TRIGGER'
}

/**
 * Los parámetros de SQLite (`sqliteMixto`, ver `EstiloParametros`), numerados COMO SQLITE:
 * cada `?NNN` es el número NNN; cada `?` a secas y cada nombre NUEVO (por su texto: `:x` y
 * `@x` ocupan cada uno su número) toman el mayor visto + 1. Clave: el nombre sin prefijo
 * o el número. Orden: los nombres por su primera aparición y detrás los números,
 * ordenados.
 */
function parametrosSqlite(tokens: readonly Token[], d: DialectoSql): ParametroSql[] {
  const porClave = new Map<string, ParametroSql>()
  const nombresVistos = new Set<string>()
  let mayor = 0
  for (const t of tokens) {
    if (t.tipo !== 'bind' || t.sinCerrar) continue
    let clave = claveDeBind(t.valor, d)
    if (t.valor === '?') {
      mayor += 1
      clave = String(mayor)
    } else if (/^\?\d+$/.test(t.valor)) {
      mayor = Math.max(mayor, Number(clave))
    } else if (!nombresVistos.has(t.valor)) {
      nombresVistos.add(t.valor)
      mayor += 1
    }
    if (clave === '') continue
    const previo = porClave.get(clave)
    if (previo) previo.apariciones.push({ desde: t.desde, hasta: t.hasta })
    else porClave.set(clave, { clave, texto: t.valor, apariciones: [{ desde: t.desde, hasta: t.hasta }] })
  }
  const todos = Array.from(porClave.values())
  const numero = (p: ParametroSql): boolean => /^\?/.test(p.texto)
  const nombres = todos.filter((p) => !numero(p))
  const numeros = todos.filter(numero).sort((a, b) => Number(a.clave) - Number(b.clave))
  return [...nombres, ...numeros]
}

/**
 * Los parámetros de `texto[desde, hasta)`, uno por clave, en orden de primera
 * aparición (PG: por número). Vacío si es el CREATE de una unidad de PL/SQL.
 */
export function parametrosSql(
  texto: string,
  d: DialectoSql,
  desde = 0,
  hasta: number = texto.length
): ParametroSql[] {
  const estilo = reglasDe(d).estiloParametros
  const tokens = tokenizar(texto, d, desde, hasta)
  if (sinParametrosDelUsuario(tokens, estilo)) return []
  switch (estilo) {
    case 'sqliteMixto':
      return parametrosSqlite(tokens, d)
    case 'dolarNumero':
    case 'dosPuntosNombre':
      break
    case 'ninguno':
      return [] // inalcanzable: `sinParametrosDelUsuario` ya devolvió []
    default:
      return nunca(estilo, 'parametrosSql (numeración)')
  }
  const porClave = new Map<string, ParametroSql>()
  for (const t of tokens) {
    if (t.tipo !== 'bind' || t.sinCerrar) continue
    const clave = claveDeBind(t.valor, d)
    if (clave === '') continue
    const previo = porClave.get(clave)
    if (previo) previo.apariciones.push({ desde: t.desde, hasta: t.hasta })
    else porClave.set(clave, { clave, texto: t.valor, apariciones: [{ desde: t.desde, hasta: t.hasta }] })
  }
  const lista = Array.from(porClave.values())
  switch (estilo) {
    case 'dolarNumero':
      lista.sort((a, b) => Number(a.clave) - Number(b.clave))
      break
    case 'dosPuntosNombre':
      // En el orden de su primera aparición, que es el del Map.
      break
    // ('sqliteMixto' ya se devolvió arriba, con su propia numeración: `parametrosSqlite`.)
    default:
      return nunca(estilo, 'parametrosSql')
  }
  return lista
}

/** Las claves que faltan en `binds` (en el orden de `params`). */
export function parametrosQueFaltan(
  params: readonly ParametroSql[],
  binds: Readonly<Record<string, string | null>> | undefined
): string[] {
  return params.filter((p) => !binds || !Object.prototype.hasOwnProperty.call(binds, p.clave)).map((p) => p.clave)
}
