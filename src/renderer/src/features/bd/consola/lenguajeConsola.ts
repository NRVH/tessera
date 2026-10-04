// =============================================================================
// Lenguajes de Monaco de las consolas: el propio de Oracle (el `sql` de Monaco más las
// q-quotes `q'…'`) y el de SQLite (comandos `.algo`, BLOB `X'..'`, parámetros, acento
// grave), DERIVADOS del `sql` de Monaco; PostgreSQL usa `pgsql` sin tocar. Qué lenguaje
// lleva cada motor lo dice su descriptor. Registro síncrono e idempotente por instancia.
// Decisiones: docs/decisiones/bd/ui-consola-monaco.md
// =============================================================================

import type { IDisposable, languages } from 'monaco-editor'
import { conf as CONF_SQL, language as LENGUAJE_SQL } from 'monaco-editor/esm/vs/basic-languages/sql/sql.js'
import type { DbMotor } from '../../../../../shared/db-ipc.ts'
import { MOTORES, descriptorSql } from '../../../../../shared/motores/index.ts'
import { RESERVADAS } from '../../../../../shared/sql/palabrasSql.ts'

/**
 * Id de Monaco del lenguaje de las consolas de Oracle: el `sql.lenguajeConsola` de su
 * descriptor (`shared/motores/oracle.ts`), DERIVADO y no copiado. El test fija que es
 * PROPIO (no el de un lenguaje de Monaco, que este registro pisaría con el Monarch de
 * Oracle en todos sus editores) y que es el de siempre (lo busca la e2e).
 */
export const LENGUAJE_ORACLE_CONSOLA: string = MOTORES.oracle.sql.lenguajeConsola

/**
 * El lenguaje de Monaco del modelo de una consola, según el motor de su conexión. Por
 * `descriptor()` y no `MOTORES[motor]`: con un motor fuera del registro, el error es el
 * «Motor desconocido» de siempre y no un TypeError anónimo al leer `.sql`.
 */
export function lenguajeConsola(motor: DbMotor): string {
  // Camino SOLO SQL: con un motor de otra familia, `descriptorSql` lanza.
  return descriptorSql(motor).sql.lenguajeConsola
}

/** Delimitadores de q-quote que se cierran con OTRO carácter. */
export const CIERRES_Q: Readonly<Record<string, string>> = { '[': ']', '{': '}', '(': ')', '<': '>' }

/** Prefijo de los estados de las q-quotes (`qcadena.<delimitador>`). */
export const ESTADO_Q = 'qcadena'

/** Un carácter como literal de regex: los alfanuméricos tal cual; el resto, escapado. */
function literal(c: string): string {
  return /[A-Za-z0-9]/.test(c) ? c : '\\' + c
}

/** Las reglas de un estado de q-quote que se cierra con `cierre` + `'`. */
function reglasDeCierre(cierre: string): languages.IMonarchLanguageRule[] {
  const c = literal(cierre)
  return [
    [new RegExp(c + "'"), { token: 'string', next: '@pop' }],
    [new RegExp('[^' + c + ']+'), 'string'],
    [new RegExp(c), 'string']
  ]
}

/**
 * Los estados de las q-quotes: uno por carácter imprimible ASCII y el padre genérico.
 * UN ESTADO POR CARÁCTER porque la vía natural (`next: '@q.$1'` y `'$1==$S2'`) no cierra:
 * con `ignoreCase` Monarch pasa a minúsculas el `$1` del nombre y no el que compara, y
 * parte el nombre por puntos (`q'.x.'`). Las MAYÚSCULAS no tienen estado propio: caen en
 * el de su minúscula. Monarch prueba las reglas EN ORDEN, así que la apertura va antes que
 * la de identificadores, que se comería la `q`. Límite aceptado: con una LETRA como
 * delimitador el cierre no distingue caja (Monarch compila con la `i` de `ignoreCase`).
 */
function estadosQ(): Record<string, languages.IMonarchLanguageRule[]> {
  const estados: Record<string, languages.IMonarchLanguageRule[]> = {
    [ESTADO_Q]: [
      // `~` (regex, compilada con la `i` de `ignoreCase`) y no `==`: el `$S2` del nombre
      // del estado llega en MINÚSCULAS y el `$1` no, así que con `==` una mayúscula no
      // ASCII (`q'ÑholaÑ'`, `q'ÉaÉ'`) no se cerraría NUNCA y el resto del archivo saldría
      // como cadena (medido con el tokenizador real). Aquí solo llegan
      // delimitadores no ASCII, que nunca son especiales en una regex.
      [/(.)'/, { cases: { '$1~$S2': { token: 'string', next: '@pop' }, '@default': 'string' } }],
      [/./, 'string']
    ]
  }
  for (let codigo = 0x21; codigo <= 0x7e; codigo++) {
    const c = String.fromCharCode(codigo)
    if (c >= 'A' && c <= 'Z') continue
    estados[`${ESTADO_Q}.${c}`] = reglasDeCierre(CIERRES_Q[c] ?? c)
  }
  return estados
}

/** La regla que abre una q-quote: `q'` o `nq'` (en cualquier caja) y su delimitador. */
export const REGLA_APERTURA_Q: languages.IMonarchLanguageRule = [
  /[nN]?[qQ]'(\S)/,
  { token: 'string', next: `@${ESTADO_Q}.$1` }
]

/**
 * El Monarch de la consola de Oracle: el de `base` (por defecto, el `sql` de Monaco)
 * con la q-quote delante de todo en `root` y sus estados. Puro: no registra nada.
 */
export function lenguajeOracleConsola(base: languages.IMonarchLanguage = LENGUAJE_SQL): languages.IMonarchLanguage {
  const raiz = base.tokenizer.root ?? []
  return {
    ...base,
    tokenizer: {
      ...base.tokenizer,
      root: [REGLA_APERTURA_Q, ...raiz],
      ...estadosQ()
    }
  }
}

/** Lo que el registro usa de `monaco` (lo cumple el de verdad; el test pasa uno falso). */
export interface MonacoLenguajes {
  languages: {
    register(lenguaje: languages.ILanguageExtensionPoint): void
    getLanguages(): languages.ILanguageExtensionPoint[]
    setLanguageConfiguration(id: string, conf: languages.LanguageConfiguration): IDisposable
    setMonarchTokensProvider(id: string, lenguaje: languages.IMonarchLanguage): IDisposable
  }
}

/**
 * Id de Monaco del lenguaje de las consolas de SQLite: el
 * `sql.lenguajeConsola` de su descriptor. PROPIO y no el `sql` de Monaco, por lo mismo que
 * el de Oracle: `sql` es también el de los `.sql` del editor de archivos, y el
 * autocompletado de la consola se registra en los lenguajes de consola.
 */
export const LENGUAJE_SQLITE_CONSOLA: string = MOTORES.sqlite.sql.lenguajeConsola

/** Estado de un identificador entre acentos graves (`` `nombre` ``), que SQLite admite. */
export const ESTADO_ACENTO = 'identificadorAcento'

/**
 * Lo que SQLite añade al `sql` de Monaco, DELANTE de todo en `root` (el orden importa: la
 * regla de palabras de Monaco, `[\w@#$]+`, se comería la `X` de `X'00'`, la `@` de `@x` y
 * el `$` de `$x`, y su regla de números leería `$1` como un número):
 *   - un comando del CLI (`.tables`, `.schema t`) al principio de la línea: la línea
 *     entera, como el divisor la trata (`lineaCliente`), y en color de palabra clave. Pide
 *     una LETRA tras el punto: `.5` es un número;
 *   - un BLOB literal (`X'0A1B'`), como cadena;
 *   - los parámetros: `?`, `?NNN`, `:x`, `@x`, `$x` y `$a::b(c)`, como variables;
 *   - el identificador entre acentos graves.
 * `[x]` y `"x"` ya los colorea el `sql` de Monaco, y sus comentarios no se anidan, como
 * los de SQLite.
 */
const REGLAS_SQLITE: languages.IMonarchLanguageRule[] = [
  [/^\s*\.[A-Za-z]\w*.*$/, 'keyword'],
  [/[xX]'[0-9A-Fa-f]*'/, 'string'],
  [/\?\d*/, 'variable'],
  [/[:@$][A-Za-z_][\w$]*(?:::[\w$]+)*(?:\([^)\s]*\))?/, 'variable'],
  [/`/, { token: 'identifier.quote', next: `@${ESTADO_ACENTO}` }]
]

/**
 * El Monarch de la consola de SQLite: el de `base` (por defecto, el `sql` de Monaco, que ya
 * colorea `[identificador]` y las palabras clave comunes) con lo de `REGLAS_SQLITE` delante
 * de todo, el estado del acento grave y, como palabras clave, las suyas más las de SQLite
 * (`RESERVADAS.sqlite`: PRAGMA, VACUUM, GLOB, ROWID…). DERIVADO y no copiado, como el de
 * Oracle; puro: no registra nada, y no muta `base`.
 */
export function lenguajeSqliteConsola(base: languages.IMonarchLanguage = LENGUAJE_SQL): languages.IMonarchLanguage {
  const raiz = base.tokenizer.root ?? []
  const propias = [...RESERVADAS.sqlite].map((p) => p.toUpperCase())
  const clave = new Set<string>([...((base.keywords as string[] | undefined) ?? []), ...propias])
  return {
    ...base,
    keywords: [...clave],
    tokenizer: {
      ...base.tokenizer,
      root: [...REGLAS_SQLITE, ...raiz],
      [ESTADO_ACENTO]: [
        [/[^`]+/, 'identifier'],
        [/``/, 'identifier'],
        [/`/, { token: 'identifier.quote', next: '@pop' }]
      ]
    }
  }
}

const registrados = new WeakSet<object>()
let definicion: languages.IMonarchLanguage | null = null
let definicionSqlite: languages.IMonarchLanguage | null = null

/**
 * Registra `tessera-oracle-sql` y `tessera-sqlite-sql` (id, configuración y
 * tokenizador) UNA vez por instancia de Monaco. PG no necesita nada: `pgsql` ya lo trae
 * Monaco. Un motor nuevo con un lenguaje de consola PROPIO se registra aquí con su
 * Monarch, o sus consolas salen en texto plano.
 */
export function registrarLenguajesConsola(monaco: MonacoLenguajes): void {
  if (registrados.has(monaco)) return
  registrados.add(monaco)
  const l = monaco.languages
  if (!l.getLanguages().some((x) => x.id === LENGUAJE_ORACLE_CONSOLA)) {
    l.register({ id: LENGUAJE_ORACLE_CONSOLA, aliases: ['Oracle SQL (consola)'] })
  }
  l.setLanguageConfiguration(LENGUAJE_ORACLE_CONSOLA, CONF_SQL)
  if (!definicion) definicion = lenguajeOracleConsola()
  l.setMonarchTokensProvider(LENGUAJE_ORACLE_CONSOLA, definicion)
  if (!l.getLanguages().some((x) => x.id === LENGUAJE_SQLITE_CONSOLA)) {
    l.register({ id: LENGUAJE_SQLITE_CONSOLA, aliases: ['SQLite (consola)'] })
  }
  l.setLanguageConfiguration(LENGUAJE_SQLITE_CONSOLA, CONF_SQL)
  if (!definicionSqlite) definicionSqlite = lenguajeSqliteConsola()
  l.setMonarchTokensProvider(LENGUAJE_SQLITE_CONSOLA, definicionSqlite)
}
