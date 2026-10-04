#!/usr/bin/env node
// =============================================================================
// Prueba de los lenguajes de las consolas (npm run test:db-lenguaje-consola) con el
// tokenizador Monarch DE VERDAD de monaco-editor (su parte `common` carga bajo `node`, por
// una ruta no literal): el lenguaje de cada motor, el porqué (`q'[it's]'` con `sql`), las
// q-quotes, lo que no lo es, la derivación sin mutar, el registro idempotente y SQLite.
// =============================================================================

import {
  CIERRES_Q,
  ESTADO_ACENTO,
  ESTADO_Q,
  LENGUAJE_ORACLE_CONSOLA,
  LENGUAJE_SQLITE_CONSOLA,
  lenguajeConsola,
  lenguajeOracleConsola,
  lenguajeSqliteConsola,
  registrarLenguajesConsola,
  type MonacoLenguajes
} from './lenguajeConsola.ts'
import { tokenizar as tokenizarLexico } from '../../../../../shared/sql/lexicoSql.ts'
import type { DbMotor } from '../../../../../shared/db-ipc.ts'
import { IDS_MOTORES, IDS_MOTORES_SQL, descriptorSql, esMotorSql, etiquetaMotor } from '../../../../../shared/motores/index.ts'
import type { languages } from 'monaco-editor'
import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Los lenguajes que trae Monaco: las carpetas de `basic-languages`, cuyo nombre es el id
 * del lenguaje (`sql`, `pgsql`, `mysql`…). Se leen del paquete instalado y no de una
 * lista escrita aquí: una subida de Monaco que sume uno lo trae sola.
 */
const LENGUAJES_MONACO: readonly string[] = readdirSync(
  dirname(dirname(fileURLToPath(import.meta.resolve('monaco-editor/esm/vs/basic-languages/sql/sql.js')))),
  { withFileTypes: true }
)
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

// --- Monarch de verdad ------------------------------------------------------------------------

interface TokenMonarch {
  offset: number
  type: string
}
interface Tokenizador {
  getInitialState(): unknown
  tokenize(linea: string, hayEol: boolean, estado: unknown): { tokens: TokenMonarch[]; endState: unknown }
}

const RAIZ = 'monaco-editor/esm/vs/'
const { compile } = (await import(RAIZ + 'editor/standalone/common/monarch/monarchCompile.js')) as {
  compile: (id: string, def: languages.IMonarchLanguage) => unknown
}
const { MonarchTokenizer } = (await import(RAIZ + 'editor/standalone/common/monarch/monarchLexer.js')) as {
  MonarchTokenizer: new (idiomas: unknown, tema: unknown, id: string, lexer: unknown, config: unknown) => Tokenizador
}
const { language: SQL_MONACO } = (await import(RAIZ + 'basic-languages/sql/sql.js')) as { language: languages.IMonarchLanguage }

function tokenizador(id: string, def: languages.IMonarchLanguage): Tokenizador {
  const config = { getValue: () => 20_000, onDidChangeConfiguration: () => ({ dispose: (): void => undefined }) }
  const idiomas = { languageIdCodec: { encodeLanguageId: () => 1 }, requestBasicLanguageFeatures: (): void => undefined }
  const tema = { getColorTheme: () => ({ tokenTheme: {} }) }
  return new MonarchTokenizer(idiomas, tema, id, compile(id, def), config)
}

/** Tokeniza varias líneas arrastrando el estado; por línea, [offset, tipo]. */
function tokenizar(t: Tokenizador, texto: string): TokenMonarch[][] {
  let estado = t.getInitialState()
  return texto.split('\n').map((linea) => {
    const r = t.tokenize(linea, true, estado)
    estado = r.endState
    return r.tokens
  })
}

/** El tipo del token que cubre la columna `col` (0-based) de una línea. */
function tipoEn(linea: TokenMonarch[], col: number): string {
  let tipo = ''
  for (const t of linea) {
    if (t.offset > col) break
    tipo = t.type
  }
  return tipo
}

/** ¿Todo `[desde, hasta)` es cadena? */
function esCadena(linea: TokenMonarch[], desde: number, hasta: number): boolean {
  for (let c = desde; c < hasta; c++) if (!tipoEn(linea, c).startsWith('string')) return false
  return true
}

const ORACLE = tokenizador(LENGUAJE_ORACLE_CONSOLA, lenguajeOracleConsola())
const SQL = tokenizador('sql', SQL_MONACO)

/** Una línea con una q-quote seguida de `from dual`: la q-quote entera cadena y `from` palabra clave. */
function qBien(q: string, t: Tokenizador = ORACLE): { ok: boolean; ev: string } {
  const linea = `select ${q} from dual`
  const [toks] = tokenizar(t, linea)
  const ini = 7
  const fin = ini + q.length
  const from = linea.indexOf(' from', fin) + 1
  const ok = esCadena(toks, ini, fin) && tipoEn(toks, from).startsWith('keyword') && !tipoEn(toks, fin).startsWith('string')
  return { ok, ev: j(toks.map((x) => [x.offset, x.type])) }
}

async function main(): Promise<void> {
  hr('(1) lenguajeConsola(motor)')
  check('Oracle -> tessera-oracle-sql', lenguajeConsola('oracle') === 'tessera-oracle-sql' && LENGUAJE_ORACLE_CONSOLA === 'tessera-oracle-sql', lenguajeConsola('oracle'))
  check('PG -> pgsql', lenguajeConsola('postgres') === 'pgsql', lenguajeConsola('postgres'))
  // Cada motor da el de SU descriptor. La constante de Oracle ES el descriptor: lo de arriba
  // fija su valor, que es el que busca la e2e. La consola SQL es de los motores SQL; con
  // MongoDB o Redis `lenguajeConsola` lanza (abajo).
  const distintos = IDS_MOTORES_SQL.filter((m) => lenguajeConsola(m) !== descriptorSql(m).sql.lenguajeConsola)
  check('cada motor -> el lenguaje de su descriptor', distintos.length === 0, JSON.stringify(distintos))
  // Con un motor fuera del registro, el error prometido y no un TypeError.
  let errorDesconocido = ''
  try {
    lenguajeConsola('mysql' as DbMotor)
  } catch (e) {
    errorDesconocido = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  }
  check('motor desconocido -> «Motor desconocido», no un TypeError', errorDesconocido === 'Error: Motor desconocido: "mysql".', errorDesconocido)
  // Un motor de OTRA familia no tiene consola SQL; se dice en voz alta, no cae en otra.
  {
    const noSql = IDS_MOTORES.filter((m) => !esMotorSql(m))
    const malos: string[] = []
    for (const m of noSql) {
      let e = ''
      try {
        lenguajeConsola(m)
      } catch (x) {
        e = x instanceof Error ? x.message : String(x)
      }
      if (e !== `${etiquetaMotor(m)} no es un motor SQL.`) malos.push(`${m}: ${e || 'no lanza'}`)
    }
    check('motor de otra familia -> «X no es un motor SQL.»', noSql.length >= 2 && malos.length === 0, malos.join(' | ') || noSql.join(', '))
  }
  check('SQLite -> tessera-sqlite-sql (propio)', lenguajeConsola('sqlite') === 'tessera-sqlite-sql' && LENGUAJE_SQLITE_CONSOLA === 'tessera-sqlite-sql', lenguajeConsola('sqlite'))
  // Lo que la constante copiada protegía de verdad: el id PROPIO no es el de un lenguaje de
  // Monaco (registrarlo pisaría ese lenguaje con el Monarch de Oracle en todos los editores,
  // también en los `.sql` del editor de archivos).
  check(
    'el lenguaje propio de Oracle no es uno de Monaco',
    LENGUAJES_MONACO.length > 20 && !LENGUAJES_MONACO.includes(LENGUAJE_ORACLE_CONSOLA),
    `${LENGUAJE_ORACLE_CONSOLA} entre ${LENGUAJES_MONACO.length} de Monaco`
  )
  // Y el color: cada lenguaje de consola del registro es de Monaco o lo registra
  // `registrarLenguajesConsola` con su tokenizador. Uno nuevo que no sea ninguno de los dos
  // saldría en texto plano sin que nada fallara.
  const propios = new Set<string>()
  registrarLenguajesConsola({
    languages: {
      register: (): void => undefined,
      getLanguages: () => [],
      setLanguageConfiguration: () => ({ dispose: (): void => undefined }),
      setMonarchTokensProvider: (id) => {
        propios.add(id)
        return { dispose: (): void => undefined }
      }
    }
  })
  const sinColor = IDS_MOTORES_SQL.filter(
    (m) => !LENGUAJES_MONACO.includes(lenguajeConsola(m)) && !propios.has(lenguajeConsola(m))
  )
  check('el lenguaje de la consola de CADA motor tiene tokenizador (de Monaco o propio)', sinColor.length === 0, JSON.stringify(sinColor))

  hr("(2) el porqué: el `sql` de Monaco se rompe con q'[it's]'")
  {
    const texto = "select q'[it's]' from dual\nwhere x = 'a'"
    const [l1, l2] = tokenizar(SQL, texto)
    check('con `sql`, `from dual` sale como cadena', tipoEn(l1, texto.indexOf('from')).startsWith('string'), j(l1))
    check('y la línea siguiente sale al revés', tipoEn(l2, 0).startsWith('string'), j(l2))
    const [o1, o2] = tokenizar(ORACLE, texto)
    check("con el de la consola, q'[it's]' es una cadena entera", esCadena(o1, 7, 16), j(o1))
    check('`from` es palabra clave', tipoEn(o1, 17).startsWith('keyword'), tipoEn(o1, 17))
    check("y la línea siguiente está bien: `where` clave y 'a' cadena", tipoEn(o2, 0).startsWith('keyword') && esCadena(o2, 10, 13), j(o2))
  }

  hr('(3) las cinco formas, N, caja y delimitadores raros')
  // `q'''a''`: con `'` de delimitador, el cierre es `''` y la primera vez que aparece
  // tras el delimitador (lo mismo que hace el léxico compartido).
  for (const q of [`q'[it's]'`, `q'{a}b}'`, `q'(x(y)'`, `q'<a>b>'`, `q'!it's!'`, `Q'[x]'`, `nq'[x]'`, `NQ'!y!'`, `q'.a.'`, `q'$a$'`, `q'@a@'`, `q'''a''`, `q'#a#'`, `q'aHOLAa'`, `q'AHOLAA'`, `q'¿hola¿'`, `q'ÑholaÑ'`, `q'ÉaÉ'`, `q'€a€'`]) {
    const r = qBien(q)
    // Y el léxico compartido (la autoridad) ve el MISMO tramo como una sola cadena.
    const lx = tokenizarLexico(`select ${q} from dual`, 'oracle')
    const deAcuerdo = lx[1] !== undefined && lx[1].tipo === 'cadena' && lx[1].desde === 7 && lx[1].hasta === 7 + q.length
    check(`${q}`, r.ok && deAcuerdo, r.ok && deAcuerdo ? 'cadena + from clave, igual que el léxico' : r.ev + ' / léxico ' + j(lx[1]))
  }
  {
    const texto = "select q'[primera\nsegunda it's\ntercera]' from dual"
    const [l1, l2, l3] = tokenizar(ORACLE, texto)
    const ok = esCadena(l1, 7, l1.length > 0 ? 'select q\'[primera'.length : 0) && esCadena(l2, 0, 'segunda it\'s'.length) && esCadena(l3, 0, 9) && tipoEn(l3, 10).startsWith('keyword')
    check('una q-quote que cruza de línea sigue siendo cadena hasta su cierre', ok, j([l1, l2, l3]))
    const [c1] = tokenizar(ORACLE, "select q'[a]' || 'b', q'!c!' from dual")
    check('dos q-quotes y una cadena normal en la misma línea', esCadena(c1, 7, 13) && esCadena(c1, 17, 20) && esCadena(c1, 22, 28) && tipoEn(c1, 29).startsWith('keyword'), j(c1))
  }

  hr('(4) lo que no es q-quote, y lo demás como en `sql`')
  {
    const [a] = tokenizar(ORACLE, "select q' x' from dual")
    check("`q' x'` (blanco tras q'): q identificador y ' x' cadena normal", tipoEn(a, 7).startsWith('identifier') && esCadena(a, 8, 12), j(a))
    const [b] = tokenizar(ORACLE, "select abq'x' from dual")
    check('un identificador que acaba en q no abre una q-quote', tipoEn(b, 7).startsWith('identifier') && esCadena(b, 10, 13), j(b))
    const texto = "-- q'[ no abre\nselect N'x', 1.5, /* q'[ */ a from dual"
    const plano = (ls: TokenMonarch[][]): string => j(ls.map((l) => l.map((x) => [x.offset, x.type])))
    const o = plano(tokenizar(ORACLE, texto))
    const s = plano(tokenizar(SQL, texto))
    check('sin q-quotes, idéntico al `sql` de Monaco (comentarios, N\'…\', números)', o === s, o)
  }

  hr('(5) la definición')
  {
    const def = lenguajeOracleConsola()
    const raiz = def.tokenizer.root
    check('la regla de q va la PRIMERA de root', Array.isArray(raiz[0]) && String((raiz[0] as unknown[])[0]).indexOf("[qQ]'") >= 0, String((raiz[0] as unknown[])[0]))
    check('el `sql` de Monaco no se muta', !String(j(SQL_MONACO.tokenizer.root[0])).includes('qQ') && !(`${ESTADO_Q}.!` in SQL_MONACO.tokenizer), j(SQL_MONACO.tokenizer.root[0]))
    check('hereda tokenPostfix .sql, ignoreCase y las palabras clave', def.tokenPostfix === '.sql' && def.ignoreCase === true && Array.isArray((def as { keywords?: unknown }).keywords), String(def.tokenPostfix))
    const estados = Object.keys(def.tokenizer).filter((k) => k === ESTADO_Q || k.startsWith(ESTADO_Q + '.'))
    check('un estado por carácter ASCII imprimible salvo A-Z, más el padre', estados.length === 94 - 26 + 1, String(estados.length))
    check('los corchetes se cierran con su pareja', j(CIERRES_Q) === j({ '[': ']', '{': '}', '(': ')', '<': '>' }), j(CIERRES_Q))
  }

  hr('(6) registro idempotente')
  {
    const hechos: string[] = []
    const lenguajes: languages.ILanguageExtensionPoint[] = []
    const falso = (): MonacoLenguajes => ({
      languages: {
        register: (l) => {
          hechos.push('register:' + l.id)
          lenguajes.push(l)
        },
        getLanguages: () => lenguajes,
        setLanguageConfiguration: (id, conf) => {
          hechos.push('conf:' + id + ':' + (conf.comments?.lineComment ?? ''))
          return { dispose: (): void => undefined }
        },
        setMonarchTokensProvider: (id) => {
          hechos.push('tokens:' + id)
          return { dispose: (): void => undefined }
        }
      }
    })
    const m = falso()
    registrarLenguajesConsola(m)
    registrarLenguajesConsola(m)
    // También el de SQLite, detrás del de Oracle y con la misma forma.
    const UNA_VEZ = [
      'register:tessera-oracle-sql',
      'conf:tessera-oracle-sql:--',
      'tokens:tessera-oracle-sql',
      'register:tessera-sqlite-sql',
      'conf:tessera-sqlite-sql:--',
      'tokens:tessera-sqlite-sql'
    ]
    check('una vez: id, configuración (con -- de comentario) y tokenizador, de cada lenguaje propio', j(hechos) === j(UNA_VEZ), j(hechos))
    registrarLenguajesConsola(falso())
    check(
      'otra instancia vuelve a registrar lo suyo, sin repetir los ids ya conocidos',
      j(hechos.slice(UNA_VEZ.length)) === j(['conf:tessera-oracle-sql:--', 'tokens:tessera-oracle-sql', 'conf:tessera-sqlite-sql:--', 'tokens:tessera-sqlite-sql']),
      j(hechos.slice(UNA_VEZ.length))
    )
  }

  hr('(7) SQLite: lo que añade al `sql` de Monaco')
  {
    const SQLITE = tokenizador(LENGUAJE_SQLITE_CONSOLA, lenguajeSqliteConsola())
    const tipos = (linea: string): string => j(tokenizar(SQLITE, linea)[0].map((x) => [x.offset, x.type.replace(/\..*$/, '')]))
    // Comando del CLI: la línea entera; pero `.5` es un número y `t.col` sigue igual.
    const [cli] = tokenizar(SQLITE, '.tables usuarios')
    check('`.tables x` al principio: un solo token de palabra clave', cli.length === 1 && cli[0].type.startsWith('keyword'), tipos('.tables usuarios'))
    const [sangrado] = tokenizar(SQLITE, '  .schema t')
    check('con sangría también', sangrado.length === 1 && sangrado[0].type.startsWith('keyword'), tipos('  .schema t'))
    const [num] = tokenizar(SQLITE, '.5 + 1')
    check('`.5` no es un comando', !num[0].type.startsWith('keyword'), tipos('.5 + 1'))
    const [cualif] = tokenizar(SQLITE, 'select t.col from t')
    check('`t.col` dentro de una línea no es un comando', tipoEn(cualif, 9).startsWith('identifier') && tipoEn(cualif, 13).startsWith('keyword'), tipos('select t.col from t'))
    // BLOB y parámetros.
    const [blob] = tokenizar(SQLITE, "select X'0A1b', x'' from t")
    check("`X'0A1b'` y `x''` son cadena entera", esCadena(blob, 7, 14) && esCadena(blob, 16, 19) && tipoEn(blob, 20).startsWith('keyword'), tipos("select X'0A1b', x'' from t"))
    const lineaParams = 'select ?, ?12, :a, @b, $c, $d::e(f) from t'
    const [params] = tokenizar(SQLITE, lineaParams)
    const posiciones = ['?,', '?12', ':a', '@b', '$c', '$d::e(f)'].map((p) => lineaParams.indexOf(p))
    const noVariables = posiciones.filter((p) => !tipoEn(params, p).startsWith('variable'))
    check('`?`, `?NNN`, `:x`, `@x`, `$x` y `$a::b(c)` son variables', noVariables.length === 0, tipos(lineaParams))
    check('y `$d::e(f)` entero, sin partir', tipoEn(params, lineaParams.indexOf('(f)') + 1).startsWith('variable'), tipos(lineaParams))
    // Acento grave (con el doble dentro) y corchetes.
    const lineaAcento = 'select `a``b`, [c d] from t'
    const [acento] = tokenizar(SQLITE, lineaAcento)
    check('`` `a``b` `` es identificador entero', tipoEn(acento, 8).startsWith('identifier') && tipoEn(acento, 10).startsWith('identifier') && tipoEn(acento, 15).startsWith('identifier'), tipos(lineaAcento))
    check('y lo de detrás sigue: `from` palabra clave', tipoEn(acento, lineaAcento.indexOf('from')).startsWith('keyword'), tipos(lineaAcento))
    // Palabras de SQLite y lo de siempre.
    const [pragma] = tokenizar(SQLITE, 'pragma table_info(t); vacuum; select 1 where a glob b')
    check('PRAGMA, VACUUM y GLOB son palabras clave', tipoEn(pragma, 0).startsWith('keyword') && tipoEn(pragma, 22).startsWith('keyword') && tipoEn(pragma, 47).startsWith('keyword'), tipos('pragma table_info(t); vacuum; select 1 where a glob b'))
    const [cad] = tokenizar(SQLITE, "select 'it''s', 0x1F -- nota")
    check("cadenas, 0x1F y comentario como en `sql`", esCadena(cad, 7, 14) && tipoEn(cad, 16).startsWith('number') && tipoEn(cad, 21).startsWith('comment'), tipos("select 'it''s', 0x1F -- nota"))
    // La definición deriva sin mutar la de Monaco.
    const def = lenguajeSqliteConsola()
    check('no muta el `sql` de Monaco', !(ESTADO_ACENTO in SQL_MONACO.tokenizer) && !String(j(SQL_MONACO.tokenizer.root[0])).includes('xX'), 'intacto')
    check('su estado de acento existe', ESTADO_ACENTO in def.tokenizer, Object.keys(def.tokenizer).join(','))
  }

  const pasadas = results.filter((r) => r.pass).length
  const allPass = pasadas === results.length
  hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
  process.exit(allPass ? 0 : 1)
}

void main()
