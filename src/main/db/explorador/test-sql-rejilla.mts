#!/usr/bin/env node
// =============================================================================
// Prueba del compositor puro del SQL de la pestaña de tabla (sqlRejilla.ts), sin electron ni
// disco: los dialectos van como parámetro. Fija la forma exacta del SQL y de los binds por
// forma de paginado, los rangos de cada fragmento, el rechazo de `;`, paréntesis y cadenas sin
// cerrar, el ROWID, el filtro guiado y el orden de la cabecera, y la traducción de errores a campo.
// Decisiones: docs/decisiones/bd/rejilla-sql-fragmentos.md, docs/decisiones/bd/rejilla-paginado.md
// =============================================================================

import {
  COLUMNA_RN,
  COLUMNA_ROWID,
  campoDeError,
  campoDeErrorEnLinea,
  campoDeErrorEnPuntosDeCodigo,
  construirConsultaTabla,
  construirConteo,
  esErrorRejilla,
  validarFragmento,
  type ConsultaRejilla,
  type ErrorRejilla,
  type PeticionConsultaTabla,
  type ResultadoRejilla
} from './sqlRejilla.ts'
import { tokenizar } from '../../../shared/sql/lexicoSql.ts'
import { dividirSentencias } from '../../../shared/sql/divisorSql.ts'
import { dialectoDeMotor, REGLAS, type DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import { descriptorSql, IDS_MOTORES_SQL, MOTORES } from '../../../shared/motores/index.ts'
import { MOTORES_EXPLORADOR } from './motores/index.ts'
import type { DbFiltroGuiado, DbOrdenColumna } from '../../../shared/filtroGuiado.ts'

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

const J = (v: unknown): string => JSON.stringify(v)

function ok(r: ResultadoRejilla): ConsultaRejilla {
  if (esErrorRejilla(r)) throw new Error('se esperaba SQL y llegó error: ' + r.error)
  return r
}

function err(r: ResultadoRejilla): ErrorRejilla | null {
  return esErrorRejilla(r) ? r : null
}

const ORA = { esquema: 'HR', nombre: 'EMP' }
const PG = { esquema: 'public', nombre: 'profile' }

function tabla(
  d: DialectoSql,
  extra: Partial<PeticionConsultaTabla> = {}
): ResultadoRejilla {
  const base: PeticionConsultaTabla =
    d === 'oracle'
      ? { dialecto: 'oracle', objeto: ORA, forma: 'cursor' }
      : { dialecto: 'postgres', objeto: PG, forma: 'limitOffset', n: 501, desde: 0 }
  return construirConsultaTabla({ ...base, ...extra })
}

/** Tras el primer comentario del SQL, ¿queda un token significativo con este valor? */
function sobreviveTrasComentario(sql: string, d: DialectoSql, valor: string): boolean {
  const toks = tokenizar(sql, d)
  const i = toks.findIndex((t) => t.tipo === 'comentario')
  if (i === -1) return false
  return toks.slice(i + 1).some((t) => t.valor === valor)
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('(1) Comillas: identificadores exactos citados duplicando "')
  {
    const r = ok(construirConsultaTabla({ dialecto: 'oracle', objeto: { esquema: 'HR', nombre: 'A"B' }, forma: 'cursor' }))
    check('Oracle "A""B"', r.sql === 'SELECT * FROM "HR"."A""B"', J(r.sql))
    const p = ok(
      construirConsultaTabla({
        dialecto: 'postgres',
        objeto: { esquema: 'Mi Esquema', nombre: 'tabla"rara' },
        forma: 'limitOffset',
        n: 10,
        desde: 0
      })
    )
    check(
      'PG con espacios, mayúsculas y comilla',
      p.sql.startsWith('SELECT * FROM "Mi Esquema"."tabla""rara"'),
      J(p.sql)
    )
    const pk = ok(
      construirConsultaTabla({
        dialecto: 'postgres',
        objeto: PG,
        forma: 'limitOffset',
        n: 10,
        desde: 0,
        pkColumnas: ['I"d']
      })
    )
    check('columna de la PK citada', pk.sql.includes('ORDER BY "I""d"'), J(pk.sql))
  }

  // ---------------------------------------------------------------------------
  hr('(2) Forma literal: cada fragmento en su línea y WHERE entre paréntesis')
  {
    const r = ok(tabla('oracle', { where: 'SAL > 10', orderBy: 'NOMBRE DESC' }))
    const esperado = 'SELECT * FROM "HR"."EMP"\nWHERE (\nSAL > 10\n)\nORDER BY NOMBRE DESC'
    check('Oracle cursor exacto', r.sql === esperado, J(r.sql))
    check('cursor sin binds ni columnas extra', J(r.binds) === '[]' && r.columnasExtraAlFinal === 0, J(r))
    check('cursor sin sinOrdenEstable', r.sinOrdenEstable === undefined, J(r.sinOrdenEstable))
    const soloWhere = ok(tabla('oracle', { where: 'X = 1' }))
    check('solo WHERE', soloWhere.sql === 'SELECT * FROM "HR"."EMP"\nWHERE (\nX = 1\n)', J(soloWhere.sql))
    const soloOrden = ok(tabla('oracle', { orderBy: '1' }))
    check('solo ORDER BY', soloOrden.sql === 'SELECT * FROM "HR"."EMP"\nORDER BY 1', J(soloOrden.sql))
    const p = ok(tabla('postgres', { where: 'id > 3', orderBy: 'nombre' }))
    check(
      'PG exacto',
      p.sql === 'SELECT * FROM "public"."profile"\nWHERE (\nid > 3\n)\nORDER BY nombre\nLIMIT $1 OFFSET $2',
      J(p.sql)
    )
  }

  // ---------------------------------------------------------------------------
  hr('(3) rangos: el slice es el texto del campo, tal cual')
  {
    const w = '  estado = \'A\'  '
    const o = ' fecha DESC NULLS LAST '
    // SQLite fuera: `tabla()` arma la petición de Oracle o de PG, y su 'keyset' es un
    // ESQUELETO hasta que lo rellene el grupo de la sesión, que lo prueba con su objeto.
    // SQL Server fuera por lo mismo: su 'offsetFetch' es un esqueleto del grupo SESIÓN.
    for (const m of IDS_MOTORES_SQL.filter((x) => x !== 'sqlite' && x !== 'sqlserver')) {
      const d = dialectoDeMotor(m)
      const formas: readonly PeticionConsultaTabla['forma'][] = descriptorSql(m).sesion.paginado.admitidas
      for (const forma of formas) {
        const r = ok(tabla(d, { where: w, orderBy: o, forma, n: 11, desde: 20 }))
        const rw = r.rangos.where
        const ro = r.rangos.orderBy
        check(
          `${d}/${forma}: where y orderBy exactos`,
          !!rw && !!ro && r.sql.slice(rw[0], rw[1]) === w && r.sql.slice(ro[0], ro[1]) === o,
          J(r.rangos)
        )
      }
    }
    const sin = ok(tabla('postgres'))
    check('sin fragmentos no hay rangos', J(sin.rangos) === '{}', J(sin.rangos))
  }

  // ---------------------------------------------------------------------------
  hr("(4) '--' en los fragmentos no se come lo que sigue")
  {
    const r = ok(tabla('oracle', { where: 'ID = 1 -- solo el uno' }))
    check('Oracle: el ) sigue vivo tras el comentario', sobreviveTrasComentario(r.sql, 'oracle', ')'), J(r.sql))
    const p = ok(tabla('postgres', { orderBy: 'nombre -- por nombre' }))
    check('PG: LIMIT sigue vivo tras el comentario del ORDER BY', sobreviveTrasComentario(p.sql, 'postgres', 'LIMIT'), J(p.sql))
    const rn = ok(tabla('oracle', { forma: 'rownum', n: 5, desde: 0, orderBy: 'ID -- x' }))
    check('ROWNUM: el cierre sobrevive al comentario', sobreviveTrasComentario(rn.sql, 'oracle', 'Q__'), J(rn.sql))
    const c = ok(construirConteo({ dialecto: 'postgres', objeto: PG, where: 'x = 1 -- y' }))
    check('conteo: el ) sobrevive', sobreviveTrasComentario(c.sql, 'postgres', ')'), J(c.sql))
  }

  // ---------------------------------------------------------------------------
  hr('(5) ROWNUM anidado (respaldo de Oracle)')
  {
    const r = ok(tabla('oracle', { forma: 'rownum', where: 'X = 1', orderBy: 'ID', n: 501, desde: 1000 }))
    const esperado =
      'SELECT * FROM (SELECT q__.*, ROWNUM "__TESSERA_RN" FROM (\n' +
      'SELECT * FROM "HR"."EMP"\nWHERE (\nX = 1\n)\nORDER BY ID' +
      '\n) q__ WHERE ROWNUM <= :hasta) WHERE "__TESSERA_RN" > :desde'
    check('SQL exacto', r.sql === esperado, J(r.sql))
    // con `rn__` sin citar, una tabla con una columna RN__ hacía ambiguo el
    // WHERE exterior (ORA-00918, medido en 11.2 y 21c). El alias va citado y con el
    // prefijo de Tessera, y es la ÚLTIMA columna (la que se quita por posición).
    const citado = new RegExp(`ROWNUM "${COLUMNA_RN}" FROM \\(\\n[\\s\\S]*WHERE "${COLUMNA_RN}" > :desde$`)
    check(
      'B2: el número de fila va con un alias CITADO que no puede chocar con una columna RN__ de la tabla',
      COLUMNA_RN === '__TESSERA_RN' && citado.test(r.sql) && !/\brn__\b/i.test(r.sql),
      J(r.sql)
    )
    check('binds con nombre hasta = desde + n', J(r.binds) === J({ hasta: 1501, desde: 1000 }), J(r.binds))
    check('columnasExtraAlFinal = 1', r.columnasExtraAlFinal === 1, String(r.columnasExtraAlFinal))
    check('con ORDER BY del usuario no hay sinOrdenEstable', r.sinOrdenEstable === undefined, J(r.sinOrdenEstable))
    const sinOrden = ok(tabla('oracle', { forma: 'rownum', n: 10, desde: 0, pkColumnas: ['ID'] }))
    check(
      'sin ORDER BY: sinOrdenEstable y SIN orden por PK (casaría mal con el cursor)',
      sinOrden.sinOrdenEstable === true && !sinOrden.sql.includes('ORDER BY'),
      J(sinOrden)
    )
    const desdeCero = ok(tabla('oracle', { forma: 'rownum', n: 10 }))
    check('desde por defecto 0', J(desdeCero.binds) === J({ hasta: 10, desde: 0 }), J(desdeCero.binds))
  }

  // ---------------------------------------------------------------------------
  hr('(6) Oracle nunca genera FETCH/OFFSET; cursor va sin paginar')
  {
    const sqls = [
      ok(tabla('oracle')).sql,
      ok(tabla('oracle', { where: 'A = 1', orderBy: 'B' })).sql,
      ok(tabla('oracle', { forma: 'rownum', n: 50, desde: 100 })).sql,
      ok(tabla('oracle', { forma: 'rownum', n: 50, desde: 100, where: 'A = 1', orderBy: 'B' })).sql,
      ok(construirConteo({ dialecto: 'oracle', objeto: ORA, where: 'A = 1' })).sql
    ]
    const conFetch = sqls.filter((s) => /\b(FETCH|OFFSET|LIMIT)\b/i.test(s))
    check('ninguna forma de Oracle lleva FETCH/OFFSET/LIMIT', conFetch.length === 0, J(conFetch))
    const c = ok(tabla('oracle', { n: 500, desde: 1000, pkColumnas: ['ID'] }))
    check(
      'cursor ignora n/desde y no ordena por PK',
      c.sql === 'SELECT * FROM "HR"."EMP"' && J(c.binds) === '[]',
      J(c)
    )
  }

  // ---------------------------------------------------------------------------
  hr('(7) LIMIT/OFFSET de PostgreSQL')
  {
    const r = ok(tabla('postgres', { orderBy: 'id', n: 501, desde: 1500 }))
    check('termina en \\nLIMIT $1 OFFSET $2', r.sql.endsWith('\nLIMIT $1 OFFSET $2'), J(r.sql))
    check('binds [n, desde]', J(r.binds) === '[501,1500]', J(r.binds))
    check('columnasExtraAlFinal = 0', r.columnasExtraAlFinal === 0, String(r.columnasExtraAlFinal))
  }

  // ---------------------------------------------------------------------------
  hr('(8) Orden por defecto por la PK (PG) y sinOrdenEstable')
  {
    const pk = ['id', 'sub']
    const r = ok(tabla('postgres', { pkColumnas: pk }))
    check(
      'sin ORDER BY del usuario: ORDER BY por la PK',
      r.sql === 'SELECT * FROM "public"."profile"\nORDER BY "id", "sub"\nLIMIT $1 OFFSET $2',
      J(r.sql)
    )
    check('el orden implícito no es un rango del usuario', r.rangos.orderBy === undefined, J(r.rangos))
    check('con PK no hay sinOrdenEstable', r.sinOrdenEstable === undefined, J(r.sinOrdenEstable))
    check('la PK de entrada no se muta', J(pk) === '["id","sub"]', J(pk))
    const sinPk = ok(tabla('postgres'))
    check(
      'sin PK: sin ORDER BY y sinOrdenEstable',
      !sinPk.sql.includes('ORDER BY') && sinPk.sinOrdenEstable === true,
      J(sinPk)
    )
    const usuario = ok(tabla('postgres', { orderBy: 'nombre', pkColumnas: pk }))
    check(
      'NEGATIVO: el ORDER BY del usuario gana a la PK',
      usuario.sql.includes('\nORDER BY nombre\n') && !usuario.sql.includes('"id"') && usuario.sinOrdenEstable === undefined,
      J(usuario.sql)
    )
    const blanco = ok(tabla('postgres', { orderBy: '   ', pkColumnas: pk }))
    check('ORDER BY en blanco cuenta como ausente: orden por PK', blanco.sql.includes('ORDER BY "id", "sub"'), J(blanco.sql))
  }

  // ---------------------------------------------------------------------------
  hr("(9) Rechazo de ';' y sus mitades negativas")
  {
    const e = err(tabla('oracle', { where: 'A = 1; DELETE FROM T' }))
    check("';' en WHERE: error con campo y posición", !!e && e.campo === 'where' && e.posicion === 5, J(e))
    const eo = err(tabla('postgres', { orderBy: 'a;' }))
    check("';' en ORDER BY: campo orderBy", !!eo && eo.campo === 'orderBy' && eo.posicion === 1, J(eo))
    const prof = err(tabla('postgres', { where: 'a IN (SELECT 1; SELECT 2)' }))
    check("';' dentro de paréntesis también se rechaza", !!prof && prof.campo === 'where' && prof.posicion === 14, J(prof))
    const negativos: Array<[DialectoSql, string]> = [
      ['oracle', "A = ';'"],
      ['oracle', 'A = 1 /* ; */'],
      ['oracle', "A = q'[;]'"],
      ['oracle', 'A = 1 -- ;'],
      ['postgres', 'a = $$;$$'],
      ['postgres', 'a = $x$;$x$'],
      ['postgres', "a = E'\\';'"],
      ['postgres', '"a;b" = 1']
    ]
    for (const [d, w] of negativos) {
      const r = tabla(d, { where: w })
      check(`NEGATIVO ${d}: ${J(w)} pasa`, !esErrorRejilla(r), esErrorRejilla(r) ? r.error : 'ok')
    }
  }

  // ---------------------------------------------------------------------------
  hr('(10) Paréntesis desequilibrados')
  {
    const h4 = 'true); COMMIT; SET default_transaction_read_only=off; DELETE FROM t; SELECT (1'
    const e = err(tabla('postgres', { where: h4 }))
    check('ataque H4 rechazado en el primer )', !!e && e.campo === 'where' && e.posicion === 4, J(e))
    const escape = err(tabla('oracle', { where: '1=1) OR (1=1' }))
    check('escape del WHERE por paréntesis rechazado', !!escape && escape.posicion === 3, J(escape))
    const sinCerrar = err(tabla('oracle', { where: 'A IN (1, (2' }))
    check('( sin cerrar: apunta al último abierto', !!sinCerrar && sinCerrar.posicion === 9, J(sinCerrar))
    const orden = err(tabla('postgres', { orderBy: 'a) q' }))
    check(') de más en el ORDER BY', !!orden && orden.campo === 'orderBy' && orden.posicion === 1, J(orden))
    const bien = tabla('oracle', { where: "(A = 1 OR B IN (1, 2)) AND C = ')'" })
    check('NEGATIVO: anidados equilibrados y ) en cadena pasan', !esErrorRejilla(bien), J(bien))
  }

  // ---------------------------------------------------------------------------
  hr('(11) Cadenas, comentarios, identificadores y $tag$ sin cerrar')
  {
    const casos: Array<[DialectoSql, string, number]> = [
      ['oracle', "A = 'abc", 4],
      ['oracle', 'A = 1 /* sin fin', 6],
      ['oracle', 'A = "COL', 4],
      ['oracle', "A = q'[abc", 4],
      ['postgres', 'a = $tag$ abc', 4],
      ['postgres', "a = E'abc\\'", 4],
      ['postgres', 'a = 1 /* /* */', 6]
    ]
    for (const [d, w, pos] of casos) {
      const e = err(tabla(d, { where: w }))
      check(`${d}: ${J(w)} rechazado`, !!e && e.campo === 'where' && e.posicion === pos, J(e))
    }
    const tag = err(tabla('postgres', { where: 'a = $tag$ abc' }))
    check('el mensaje nombra la etiqueta $tag$', !!tag && tag.error.includes('$tag$'), J(tag))
  }

  // ---------------------------------------------------------------------------
  hr('(12) Ampliaciones: binds, psql y FOR UPDATE')
  {
    const bo = err(tabla('oracle', { where: 'ID = :id' }))
    check('Oracle :id rechazado', !!bo && bo.posicion === 5 && bo.error.includes(':id'), J(bo))
    const bp = err(tabla('postgres', { where: 'id = $1' }))
    check('PG $1 rechazado', !!bp && bp.posicion === 5, J(bp))
    const cast = tabla('postgres', { where: "fecha::date = '2026-01-01'" })
    check('NEGATIVO: el cast :: de PG no es un bind', !esErrorRejilla(cast), J(cast))
    const asign = tabla('postgres', { where: "a[1:2] = '{1,2}'" })
    check('NEGATIVO: el rango de array a[1:2] de PG pasa', !esErrorRejilla(asign), J(asign))
    const psql = err(tabla('postgres', { where: '\\x ; DELETE FROM t' }))
    check('metacomando de psql rechazado', !!psql && psql.posicion === 0, J(psql))
    const forUpd = err(tabla('oracle', { orderBy: 'ID FOR UPDATE' }))
    check('FOR UPDATE en ORDER BY rechazado', !!forUpd && forUpd.campo === 'orderBy' && forUpd.posicion === 3, J(forUpd))
    const forShare = err(tabla('postgres', { orderBy: 'id FOR SHARE' }))
    check('FOR SHARE en ORDER BY rechazado', !!forShare && forShare.campo === 'orderBy', J(forShare))
    const substr = tabla('postgres', { where: "substring(nombre from 1 for 2) = 'ab'" })
    check('NEGATIVO: FOR dentro de paréntesis del WHERE pasa', !esErrorRejilla(substr), J(substr))
    const colFor = tabla('oracle', { orderBy: '"FOR"' })
    check('NEGATIVO: una columna citada "FOR" pasa', !esErrorRejilla(colFor), J(colFor))
  }

  // ---------------------------------------------------------------------------
  hr('(13) Fragmentos vacíos, en blanco o solo con comentarios')
  {
    const casos = ['', '   ', '\n\t', '-- nada', '/* nada */']
    for (const w of casos) {
      const r = ok(tabla('oracle', { where: w, orderBy: w }))
      check(`${J(w)} no emite cláusulas`, r.sql === 'SELECT * FROM "HR"."EMP"' && J(r.rangos) === '{}', J(r.sql))
    }
    const nulo = ok(tabla('oracle', { where: null, orderBy: null }))
    check('null cuenta como vacío', nulo.sql === 'SELECT * FROM "HR"."EMP"', J(nulo.sql))
    const v = validarFragmento('-- x', 'where', 'oracle')
    check('validarFragmento marca vacío', !esErrorRejilla(v) && v.vacio, J(v))
  }

  // ---------------------------------------------------------------------------
  hr('(14) campoDeError: del offset del servidor al campo')
  {
    const r = ok(tabla('postgres', { where: 'a = ', orderBy: 'b,' }))
    const [wi, wf] = r.rangos.where ?? [0, 0]
    const [oi, of] = r.rangos.orderBy ?? [0, 0]
    check('dentro del WHERE', J(campoDeError(r, wi + 2)) === J({ campo: 'where', posicion: 2 }), J(campoDeError(r, wi + 2)))
    const cierre = r.sql.indexOf(')', wf)
    check(
      'en el ) que cierra el WHERE -> final del campo',
      J(campoDeError(r, cierre)) === J({ campo: 'where', posicion: 4 }),
      J(campoDeError(r, cierre))
    )
    check('dentro del ORDER BY', J(campoDeError(r, oi + 1)) === J({ campo: 'orderBy', posicion: 1 }), J(campoDeError(r, oi + 1)))
    const limit = r.sql.indexOf('LIMIT')
    check(
      'en el LIMIT que sigue al ORDER BY -> final del campo',
      J(campoDeError(r, limit)) === J({ campo: 'orderBy', posicion: of - oi }),
      J(campoDeError(r, limit))
    )
    check('en el SELECT -> null', campoDeError(r, 0) === null, J(campoDeError(r, 0)))
    check('en el $1 del LIMIT -> null', campoDeError(r, r.sql.indexOf('$1')) === null, 'fuera')
    check('offset no finito -> null', campoDeError(r, Number.NaN) === null, 'NaN')

    const fin = ok(tabla('oracle', { orderBy: 'ID,' }))
    check(
      'Oracle: error al final del texto -> final del ORDER BY',
      J(campoDeError(fin, fin.sql.length)) === J({ campo: 'orderBy', posicion: 3 }),
      J(campoDeError(fin, fin.sql.length))
    )
    const rn = ok(tabla('oracle', { forma: 'rownum', n: 5, desde: 0, where: 'X = ' }))
    const rwi = (rn.rangos.where ?? [0, 0])[0]
    check('ROWNUM: offsets desplazados', J(campoDeError(rn, rwi + 1)) === J({ campo: 'where', posicion: 1 }), J(rn.rangos))

    // Emoji antes del error: el trabajador manda puntos de código.
    const emo = ok(tabla('postgres', { where: "x = '😀' AND y" }))
    const [ei] = emo.rangos.where ?? [0, 0]
    const cpInicioWhere = Array.from(emo.sql.slice(0, ei)).length
    const cpDeY = cpInicioWhere + Array.from("x = '😀' AND ").length
    const m = campoDeErrorEnPuntosDeCodigo(emo, cpDeY)
    check(
      'campoDeErrorEnPuntosDeCodigo convierte el astral a UTF-16',
      J(m) === J({ campo: 'where', posicion: "x = '😀' AND ".length }),
      J(m)
    )
    check('offsetCp negativo -> null', campoDeErrorEnPuntosDeCodigo(emo, -1) === null, 'null')
  }

  // ---------------------------------------------------------------------------
  hr('(15) construirConteo')
  {
    const r = ok(construirConteo({ dialecto: 'oracle', objeto: ORA, where: 'X = 1' }))
    check('SQL exacto', r.sql === 'SELECT COUNT(*) FROM "HR"."EMP"\nWHERE (\nX = 1\n)', J(r.sql))
    check('sin binds, sin columnas extra', J(r.binds) === '[]' && r.columnasExtraAlFinal === 0, J(r))
    check('rango del WHERE', r.sql.slice(...(r.rangos.where ?? [0, 0])) === 'X = 1', J(r.rangos))
    const sin = ok(construirConteo({ dialecto: 'postgres', objeto: PG }))
    check('sin WHERE', sin.sql === 'SELECT COUNT(*) FROM "public"."profile"', J(sin.sql))
    const e = err(construirConteo({ dialecto: 'postgres', objeto: PG, where: 'true); DELETE FROM t; SELECT (1' }))
    check('valida el WHERE igual que la rejilla', !!e && e.campo === 'where' && e.posicion === 4, J(e))
  }

  // ---------------------------------------------------------------------------
  hr('(16) Errores que no son de un campo')
  {
    const f1 = err(construirConsultaTabla({ dialecto: 'oracle', objeto: ORA, forma: 'limitOffset', n: 5 }))
    check('Oracle + limitOffset rechazado (nunca OFFSET en Oracle)', !!f1 && f1.campo === null, J(f1))
    const f2 = err(construirConsultaTabla({ dialecto: 'postgres', objeto: PG, forma: 'rownum', n: 5 }))
    check('PG + rownum rechazado', !!f2 && f2.campo === null, J(f2))
    const f3 = err(construirConsultaTabla({ dialecto: 'postgres', objeto: PG, forma: 'limitOffset' }))
    check('limitOffset sin n rechazado', !!f3 && f3.campo === null, J(f3))
    const f4 = err(construirConsultaTabla({ dialecto: 'postgres', objeto: PG, forma: 'limitOffset', n: 0 }))
    check('n = 0 rechazado', !!f4, J(f4))
    const f5 = err(construirConsultaTabla({ dialecto: 'oracle', objeto: ORA, forma: 'rownum', n: 5, desde: -1 }))
    check('desde negativo rechazado', !!f5, J(f5))
    const f6 = err(construirConsultaTabla({ dialecto: 'oracle', objeto: ORA, forma: 'rownum', n: 1.5 }))
    check('n no entero rechazado', !!f6, J(f6))
    const f7 = err(construirConsultaTabla({ dialecto: 'oracle', objeto: { esquema: '', nombre: 'X' }, forma: 'cursor' }))
    check('esquema vacío rechazado', !!f7 && f7.campo === null, J(f7))
    const f8 = err(construirConsultaTabla({ dialecto: 'oracle', objeto: { esquema: 'PUBLIC', nombre: 'DUAL' }, forma: 'cursor' }))
    check('PUBLIC sin resolver rechazado en Oracle', !!f8 && f8.error.includes('sinónimo'), J(f8))
    const pgPublic = tabla('postgres', { objeto: { esquema: 'PUBLIC', nombre: 't' } })
    check('NEGATIVO: en PG un esquema "PUBLIC" es un nombre más', !esErrorRejilla(pgPublic), J(pgPublic))
    const link = ok(tabla('oracle', { objeto: { esquema: 'VENTAS', nombre: 'PEDIDO', dblink: 'REMOTO.EMPRESA.COM' } }))
    check('dblink sin comillas', link.sql === 'SELECT * FROM "VENTAS"."PEDIDO"@REMOTO.EMPRESA.COM', J(link.sql))
    const raro = ok(tabla('oracle', { objeto: { esquema: 'V', nombre: 'P', dblink: 'x"; DROP' } }))
    check('dblink raro va citado', raro.sql === 'SELECT * FROM "V"."P"@"x""; DROP"', J(raro.sql))
    const sinEsq = ok(tabla('oracle', { objeto: { esquema: '', nombre: 'EMP', dblink: 'REMOTO' } }))
    check('sinónimo remoto sin esquema: nombre sin calificar', sinEsq.sql === 'SELECT * FROM "EMP"@REMOTO', J(sinEsq.sql))
    const pgLink = err(tabla('postgres', { objeto: { esquema: 'a', nombre: 'b', dblink: 'X' } }))
    check('PG con dblink rechazado', !!pgLink && pgLink.campo === null, J(pgLink))
    const conteoMal = err(construirConteo({ dialecto: 'oracle', objeto: { esquema: 'PUBLIC', nombre: 'X' } }))
    check('conteo también rechaza PUBLIC', !!conteoMal, J(conteoMal))
  }

  // ---------------------------------------------------------------------------
  hr('(17) Todo SQL válido compuesto es UNA sentencia para el divisor compartido')
  {
    const casos: Array<[DialectoSql, Partial<PeticionConsultaTabla>]> = [
      ['oracle', { where: "A = ';' -- ;", orderBy: 'B -- ;' }],
      ['oracle', { forma: 'rownum', n: 5, desde: 5, where: "A = q'[;]'", orderBy: 'B /* ; */' }],
      ['postgres', { where: 'a = $$;$$ -- ;', orderBy: 'b -- ;' }],
      ['postgres', { where: '"a;b" IS NULL', pkColumnas: ['id'] }]
    ]
    for (const [d, extra] of casos) {
      const r = ok(tabla(d, extra))
      const ss = dividirSentencias(r.sql, d)
      const toks = tokenizar(r.sql, d)
      let prof = 0
      let minimo = 0
      for (const t of toks) {
        if (t.tipo === 'parenA') prof++
        if (t.tipo === 'parenC') prof--
        if (prof < minimo) minimo = prof
      }
      check(
        `${d} ${J(extra)}: 1 sentencia, sin ';', paréntesis equilibrados`,
        ss.length === 1 && !toks.some((t) => t.tipo === 'puntoYComa') && prof === 0 && minimo === 0,
        `sentencias=${ss.length} prof=${prof} min=${minimo}`
      )
    }
  }

  // ---------------------------------------------------------------------------
  hr('(18) ROWID: columna oculta la ÚLTIMA, sin alias de tabla')
  {
    const r = ok(tabla('oracle', { rowid: true, where: '"HR"."EMP"."ID" > 0 AND EMP.SUELDO >= 0', orderBy: 'ID' }))
    check(
      'cursor: asterisco calificado por el objeto y el ROWID como texto al final',
      r.sql.startsWith(`SELECT "HR"."EMP".*, ROWIDTOCHAR(ROWID) AS "${COLUMNA_ROWID}" FROM "HR"."EMP"\nWHERE (\n`),
      J(r.sql)
    )
    check(
      'sin alias de tabla: el WHERE calificado por el nombre de la tabla sigue valiendo',
      !/FROM "HR"\."EMP" [a-z]/i.test(r.sql) && r.sql.includes('"HR"."EMP"."ID" > 0 AND EMP.SUELDO >= 0'),
      J(r.sql)
    )
    check('rangos siguen apuntando al texto del campo', r.sql.slice(r.rangos.where![0], r.rangos.where![1]) === '"HR"."EMP"."ID" > 0 AND EMP.SUELDO >= 0', J(r.rangos))
    const rn = ok(tabla('oracle', { rowid: true, forma: 'rownum', n: 10, desde: 20 }))
    check(
      'ROWNUM de respaldo: q__.* conserva el ROWID delante de "__TESSERA_RN", que es la única que se quita',
      rn.sql.startsWith('SELECT * FROM (SELECT q__.*, ROWNUM "__TESSERA_RN" FROM (\nSELECT "HR"."EMP".*, ROWIDTOCHAR(ROWID)') && rn.columnasExtraAlFinal === 1,
      J(rn.sql)
    )
    check('una sola sentencia para el divisor', dividirSentencias(r.sql, 'oracle').length === 1, 'ok')
    const sin = ok(tabla('oracle'))
    check('NEGATIVO: sin `rowid`, el SELECT * de siempre', sin.sql === 'SELECT * FROM "HR"."EMP"' && !sin.sql.includes('ROWID'), J(sin.sql))
    const enPg = err(tabla('postgres', { rowid: true }))
    check('NEGATIVO: en PG no existe', enPg !== null && /Oracle/.test(enPg.error) && enPg.campo === null, J(enPg))
    const remoto = err(tabla('oracle', { rowid: true, objeto: { esquema: 'HR', nombre: 'EMP', dblink: 'REMOTO' } }))
    check('NEGATIVO: un objeto remoto (@dblink) no se lee con ROWID', remoto !== null && /dblink/.test(remoto.error), J(remoto))
    const conteo = ok(construirConteo({ dialecto: 'oracle', objeto: ORA, where: 'X = 1' }))
    check('NEGATIVO: Contar no lleva ROWID', !conteo.sql.includes('ROWID'), J(conteo.sql))
  }

  // ---------------------------------------------------------------------------
  hr('(19) lo que decide el descriptor, con los mensajes de antes AL BYTE')
  {
    // Antes: Oracle admitía cursor y rownum; PG solo limitOffset. Ahora lo dice
    // `sesion.paginado.admitidas`; la matriz entera, con el mensaje exacto del rechazo.
    // (SQLite no entra en la matriz de «antes»: sus formas las fija su propio test.)
    const antes: Record<DialectoSql, readonly string[]> = { oracle: ['cursor', 'rownum'], postgres: ['limitOffset'], sqlite: ['keyset', 'limitOffset'], sqlserver: ['offsetFetch'] }
    const malas: string[] = []
    for (const d of ['oracle', 'postgres'] as const) {
      for (const forma of ['cursor', 'rownum', 'limitOffset', 'otra'] as const) {
        const r = construirConsultaTabla({ ...(d === 'oracle' ? { dialecto: d, objeto: ORA } : { dialecto: d, objeto: PG }), forma: forma as PeticionConsultaTabla['forma'], n: 5, desde: 0 })
        const admitida = antes[d].indexOf(forma) >= 0
        const esperado = admitida ? null : `La forma de paginado «${forma}» no vale para ${d}.`
        const real = esErrorRejilla(r) ? r.error : null
        if (real !== esperado) malas.push(`${d}/${forma}: ${J(real)}`)
      }
    }
    check('formas admitidas por motor = las de antes, y el rechazo con su texto', malas.length === 0, malas.join(' | ') || '8 casos')
    const f = (r: ResultadoRejilla): string | null => (esErrorRejilla(r) ? r.error : null)
    check(
      'dblink en PG: el mensaje de siempre',
      f(tabla('postgres', { objeto: { esquema: 'a', nombre: 'b', dblink: 'X' } })) === 'Solo Oracle tiene enlaces de base de datos (@dblink).',
      J(f(tabla('postgres', { objeto: { esquema: 'a', nombre: 'b', dblink: 'X' } })))
    )
    check(
      'PUBLIC en Oracle: el mensaje de siempre (tabla y Contar)',
      f(tabla('oracle', { objeto: { esquema: 'PUBLIC', nombre: 'DUAL' } })) === 'PUBLIC no es un esquema: hay que resolver el sinónimo antes de consultarlo.' &&
        f(construirConteo({ dialecto: 'oracle', objeto: { esquema: 'PUBLIC', nombre: 'X' } })) === 'PUBLIC no es un esquema: hay que resolver el sinónimo antes de consultarlo.',
      J(f(tabla('oracle', { objeto: { esquema: 'PUBLIC', nombre: 'DUAL' } })))
    )
    check(
      'NEGATIVO: en Oracle «public» en minúsculas es un esquema más (el pseudo-esquema es exacto)',
      !esErrorRejilla(tabla('oracle', { objeto: { esquema: 'public', nombre: 'T' } })),
      'ok'
    )
    check(
      // SQLite declara 'rowid' y el mensaje, sacado del registro, lo nombra.
      'ROWID: los dos mensajes (el de ROWID ya nombra a SQLite, del registro)',
      f(tabla('postgres', { rowid: true })) === 'ROWID solo existe en Oracle y SQLite.' &&
        f(tabla('oracle', { rowid: true, objeto: { esquema: 'HR', nombre: 'EMP', dblink: 'REMOTO' } })) === 'Un objeto remoto (@dblink) no se lee con su ROWID.',
      J([f(tabla('postgres', { rowid: true })), f(tabla('oracle', { rowid: true, objeto: { esquema: 'HR', nombre: 'EMP', dblink: 'REMOTO' } }))])
    )
    check(
      'el descriptor dice lo que decían los literales: dblinks y PUBLIC solo en Oracle, ROWID solo en Oracle',
      MOTORES.oracle.catalogo.tieneDblinks && !MOTORES.postgres.catalogo.tieneDblinks &&
        MOTORES.oracle.catalogo.pseudoEsquemaPublico === 'PUBLIC' && MOTORES.postgres.catalogo.pseudoEsquemaPublico === null &&
        MOTORES.oracle.sesion.identidadSinPk === 'rowid' && MOTORES.postgres.sesion.identidadSinPk !== 'rowid',
      'ok'
    )
    // Los dos mensajes de lo que PG no tiene nombran los
    // motores del REGISTRO que sí lo tienen, no un «Oracle» escrito a mano. Con la etiqueta
    // de Oracle cambiada a propósito (y restaurada), los dos la siguen; un literal pasaría
    // los casos de arriba y no éste.
    const descriptorOracle = MOTORES.oracle as { etiqueta: string }
    const etiqueta = descriptorOracle.etiqueta
    let conOtra: Array<string | null> = []
    try {
      descriptorOracle.etiqueta = 'Oracle de prueba'
      conOtra = [f(tabla('postgres', { objeto: { esquema: 'a', nombre: 'b', dblink: 'X' } })), f(tabla('postgres', { rowid: true }))]
    } finally {
      descriptorOracle.etiqueta = etiqueta
    }
    check(
      'los mensajes de dblink y ROWID nombran la etiqueta del registro (cambiada: «Oracle de prueba»)',
      conOtra[0] === 'Solo Oracle de prueba tiene enlaces de base de datos (@dblink).' && conOtra[1] === 'ROWID solo existe en Oracle de prueba y SQLite.',
      J(conOtra)
    )
    // Y sin ningún motor que lo tenga (Oracle sin dblinks y sin ROWID, a propósito y
    // restaurado), la frase no queda a medias («ROWID solo existe en .»).
    const catalogoOracle = MOTORES.oracle.catalogo as { tieneDblinks: boolean }
    const sesionOracle = MOTORES.oracle.sesion as { identidadSinPk: string }
    // (SQLite también tiene ROWID; se le quita igual, y se restaura.)
    const sesionSqlite = MOTORES.sqlite.sesion as { identidadSinPk: string }
    const [dblinks, sinPk, sinPkSqlite] = [catalogoOracle.tieneDblinks, sesionOracle.identidadSinPk, sesionSqlite.identidadSinPk]
    let sinNinguno: Array<string | null> = []
    try {
      catalogoOracle.tieneDblinks = false
      sesionOracle.identidadSinPk = 'unicaNoNula'
      sesionSqlite.identidadSinPk = 'unicaNoNula'
      sinNinguno = [f(tabla('postgres', { objeto: { esquema: 'a', nombre: 'b', dblink: 'X' } })), f(tabla('postgres', { rowid: true }))]
    } finally {
      sesionSqlite.identidadSinPk = sinPkSqlite
      catalogoOracle.tieneDblinks = dblinks
      sesionOracle.identidadSinPk = sinPk
    }
    check(
      'sin ningún motor con dblinks ni ROWID, los mensajes lo dicen entero',
      sinNinguno[0] === 'Ningún motor tiene enlaces de base de datos (@dblink).' && sinNinguno[1] === 'Ningún motor lee las filas por su ROWID.',
      J(sinNinguno)
    )
    // los marcadores del LIMIT/OFFSET son los del DIALECTO
    // (`marcadorPosicional`), no `$1`/`$2` escritos a mano. Con el marcador de PG cambiado
    // a propósito (y restaurado) la consulta lo sigue; el texto de PG de siempre lo fijan
    // (1) y (6).
    const reglasPg = REGLAS.postgres as { marcadorPosicional: string }
    const marcador = reglasPg.marcadorPosicional
    let conOtro: ResultadoRejilla | null = null
    try {
      reglasPg.marcadorPosicional = 'dosPuntos'
      conOtro = tabla('postgres')
    } finally {
      reglasPg.marcadorPosicional = marcador
    }
    const sqlOtro = conOtro !== null && !esErrorRejilla(conOtro) ? conOtro.sql : J(conOtro)
    const dePg = tabla('postgres')
    check(
      'limitOffset: los marcadores salen del dialecto (con los de Oracle, `:1`/`:2`); con los de PG, `$1`/`$2`',
      sqlOtro.endsWith('\nLIMIT :1 OFFSET :2') && !esErrorRejilla(dePg) && dePg.sql.endsWith('\nLIMIT $1 OFFSET $2'),
      J([sqlOtro, esErrorRejilla(dePg) ? dePg : dePg.sql])
    )
    // la expresión que lee el ROWID es de la
    // SESIÓN del motor (`sqlColumnaRowid`), no un `ROWIDTOCHAR(ROWID)` escrito aquí detrás
    // de 'rowid'. Cambiada a propósito (y restaurada), la cabecera la sigue; la de Oracle de
    // siempre la fija (18) al byte. Y PG, que no la tiene, lo dice con nombre si se le pide.
    const sesionMainOracle = MOTORES_EXPLORADOR.oracle.sesion
    const expr = sesionMainOracle.sqlColumnaRowid
    let conOtraExpr: ResultadoRejilla | null = null
    try {
      sesionMainOracle.sqlColumnaRowid = () => 'MARCA(ROWID)'
      conOtraExpr = tabla('oracle', { rowid: true })
    } finally {
      sesionMainOracle.sqlColumnaRowid = expr
    }
    const sqlExpr = conOtraExpr !== null && !esErrorRejilla(conOtraExpr) ? conOtraExpr.sql : J(conOtraExpr)
    check(
      'la expresión del ROWID la decide la sesión del motor (cambiada a propósito, se sigue)',
      sqlExpr === `SELECT "HR"."EMP".*, MARCA(ROWID) AS "${COLUMNA_ROWID}" FROM "HR"."EMP"`,
      sqlExpr
    )
    let dePgRowid: string
    try {
      dePgRowid = MOTORES_EXPLORADOR.postgres.sesion.sqlColumnaRowid()
    } catch (e) {
      dePgRowid = `lanza: ${(e as Error).message}`
    }
    check('NEGATIVO: PG no tiene ROWID y lo dice con nombre', dePgRowid === 'lanza: Catálogo: «ROWID» no existe en PostgreSQL', dePgRowid)
  }

  // ---------------------------------------------------------------------------
  hr('(20) paginado POR CLAVE (keyset, SQLite)')
  {
    const SQ = { esquema: 'main', nombre: 'numeros' }
    const k = (extra: Partial<PeticionConsultaTabla> = {}): ResultadoRejilla =>
      construirConsultaTabla({ dialecto: 'sqlite', objeto: SQ, forma: 'keyset', n: 501, desde: 0, ...extra })
    const p1 = ok(k({ clave: { tipo: 'rowid', alias: 'rowid' } }))
    check(
      'primera página por rowid: `*` a secas, la clave oculta al final, ORDER BY y LIMIT ?1',
      p1.sql === 'SELECT *, rowid AS "__TESSERA_CLAVE_1" FROM "main"."numeros"\nORDER BY rowid\nLIMIT ?1' &&
        J(p1.binds) === '[501]' && p1.columnasClave === 1 && p1.columnasExtraAlFinal === 0 && p1.sinOrdenEstable === undefined,
      J(p1)
    )
    const despues = [{ sqlite: 'entero' as const, valor: '500' }]
    const p2 = ok(k({ clave: { tipo: 'rowid', alias: '_rowid_' }, despues, where: 'n > 3' }))
    check(
      'siguiente página: detrás de la clave (con el WHERE del usuario en su paréntesis), sin OFFSET',
      p2.sql === 'SELECT *, _rowid_ AS "__TESSERA_CLAVE_1" FROM "main"."numeros"\nWHERE (\nn > 3\n)\n  AND _rowid_ > ?1\nORDER BY _rowid_\nLIMIT ?2' &&
        J(p2.binds) === J([...despues, 501]) && J(p2.rangos.where) === J([p2.sql.indexOf('n > 3'), p2.sql.indexOf('n > 3') + 5]),
      J(p2)
    )
    const pk = ok(k({ clave: { tipo: 'pk', columnas: ['pedido_id', 'n'] }, despues: ['1', '2'] }))
    check(
      'PK compuesta: comparación de fila (a, b) > (?1, ?2)',
      pk.sql === 'SELECT *, "pedido_id" AS "__TESSERA_CLAVE_1", "n" AS "__TESSERA_CLAVE_2" FROM "main"."numeros"\nWHERE ("pedido_id", "n") > (?1, ?2)\nORDER BY "pedido_id", "n"\nLIMIT ?3' &&
        pk.columnasClave === 2,
      J(pk)
    )
    const conRowid = ok(k({ clave: { tipo: 'rowid', alias: 'rowid' }, rowid: true, aliasRowid: 'rowid' }))
    check(
      'con la columna del ROWID de edición: va delante de la clave (la rejilla la encuentra la última)',
      conRowid.sql.startsWith(`SELECT *, rowid AS "${COLUMNA_ROWID}", rowid AS "__TESSERA_CLAVE_1" FROM "main"."numeros"`),
      conRowid.sql
    )
    const ord = ok(k({ clave: { tipo: 'rowid', alias: 'rowid' }, orderBy: 'n desc', desde: 500 }))
    check(
      'con ORDER BY del usuario: LIMIT/OFFSET con los marcadores de SQLite, sin clave',
      ord.sql === 'SELECT * FROM "main"."numeros"\nORDER BY n desc\nLIMIT ?1 OFFSET ?2' && J(ord.binds) === '[501,500]' && !ord.columnasClave,
      J(ord)
    )
    const sinClave = ok(k({ pkColumnas: [] }))
    check('sin clave (una vista): LIMIT/OFFSET y la píldora de orden', sinClave.sinOrdenEstable === true && !sinClave.columnasClave, J(sinClave))
    const malAlias = err(k({ clave: { tipo: 'rowid', alias: 'rowid; drop table x' } }))
    const malDespues = err(k({ clave: { tipo: 'pk', columnas: ['a', 'b'] }, despues: ['1'] }))
    check('NEGATIVO: un alias que no es de rowid y una clave que no cuadra se rechazan', malAlias !== null && malDespues !== null, J([malAlias, malDespues]))
    const noAdmitida = err(construirConsultaTabla({ dialecto: 'postgres', objeto: PG, forma: 'keyset', n: 10, clave: { tipo: 'pk', columnas: ['id'] } }))
    check('NEGATIVO: PG no admite keyset', noAdmitida !== null && /no vale para postgres/.test(noAdmitida.error), J(noAdmitida))
    // Oracle NO cambia: la cabecera del ROWID sigue calificada con el objeto entero.
    const ora = ok(tabla('oracle', { rowid: true }))
    check('Oracle al byte: `"HR"."EMP".*, ROWIDTOCHAR(ROWID)`', ora.sql === `SELECT "HR"."EMP".*, ROWIDTOCHAR(ROWID) AS "${COLUMNA_ROWID}" FROM "HR"."EMP"`, ora.sql)
  }

  // ---------------------------------------------------------------------------
  hr('(21) filtro guiado y orden de la cabecera en TODAS las formas')
  {
    const F: DbFiltroGuiado = {
      union: 'todas',
      condiciones: [
        { columna: 'NOMBRE', categoria: 'texto', operador: 'contiene', valor: 'a_b' },
        { columna: 'SUELDO', categoria: 'numero', operador: 'mayor', valor: '10' }
      ]
    }
    const O: DbOrdenColumna[] = [{ columna: 'SUELDO', dir: 'desc' }, { columna: 'ID', dir: 'asc' }]
    const SQ = { esquema: 'main', nombre: 'emp' }
    const SS = { esquema: 'dbo', nombre: 'emp' }

    // cursor (Oracle): con filtro, binds POR NOMBRE; sin él, `[]` como siempre.
    const cur = ok(tabla('oracle', { filtro: F, orden: O }))
    check(
      'cursor Oracle: WHERE compilado en su paréntesis, ORDER BY de la cabecera, binds por nombre',
      cur.sql ===
        `SELECT * FROM "HR"."EMP"\nWHERE (\nLOWER("NOMBRE") LIKE LOWER(:f1) ESCAPE '!'\nAND "SUELDO" > TO_NUMBER(:f2, '99', 'NLS_NUMERIC_CHARACTERS=''.,''')\n)\nORDER BY "SUELDO" DESC, "ID" ASC` &&
        J(cur.binds) === J({ f1: '%a!_b%', f2: '10' }),
      J(cur)
    )
    check('cursor Oracle SIN filtro: binds `[]`, al byte', J(ok(tabla('oracle')).binds) === '[]', J(ok(tabla('oracle')).binds))
    // el orden de la cabecera SÍ lleva rango, para que un error del servidor
    // al ordenar vuelva como `campo: 'orderBy'` (bajo la barra) y no se coma la rejilla.
    check(
      'el orden de la cabecera lleva su rango (un error al ordenar vuelve con campo); WHERE libre, no',
      cur.rangos.orderBy !== undefined && cur.sql.slice(cur.rangos.orderBy[0], cur.rangos.orderBy[1]) === '"SUELDO" DESC, "ID" ASC' && cur.rangos.where === undefined,
      J(cur.rangos)
    )
    const cortes = (cur.rangos.filtro ?? []).map(([a, b]) => cur.sql.slice(a, b))
    check('rangos.filtro: cada uno es la línea de su condición', cortes.length === 2 && cortes[0].startsWith('LOWER("NOMBRE")') && cortes[1].startsWith('AND "SUELDO"'), J(cortes))

    // rownum (Oracle): los del filtro junto a `:hasta`/`:desde`, y los rangos desplazados.
    const rn = ok(tabla('oracle', { forma: 'rownum', n: 51, desde: 50, filtro: F }))
    const rnCortes = (rn.rangos.filtro ?? []).map(([a, b]) => rn.sql.slice(a, b))
    check('rownum: `{ f1, f2, hasta, desde }` y la píldora sin orden', J(rn.binds) === J({ f1: '%a!_b%', f2: '10', hasta: 101, desde: 50 }) && rn.sinOrdenEstable === true, J(rn.binds))
    check('rownum: rangos del filtro desplazados por el prefijo', rnCortes.length === 2 && rnCortes[0].startsWith('LOWER("NOMBRE")'), J(rnCortes))
    const rnO = ok(tabla('oracle', { forma: 'rownum', n: 51, desde: 0, orden: O }))
    check('rownum con orden de la cabecera: sin píldora', rnO.sinOrdenEstable === undefined && rnO.sql.includes('ORDER BY "SUELDO" DESC, "ID" ASC\n) q__'), rnO.sql)

    // limitOffset (PG): el LIMIT/OFFSET DETRÁS de los del filtro.
    const lo = ok(tabla('postgres', { filtro: F, pkColumnas: ['id'], desde: 500 }))
    check(
      'limitOffset PG: `$1`,`$2` del filtro y `LIMIT $3 OFFSET $4`; ordenado por la PK',
      lo.sql.endsWith('\n)\nORDER BY "id"\nLIMIT $3 OFFSET $4') && J(lo.binds) === J(['%a!_b%', '10', 501, 500]),
      J(lo)
    )
    const loO = ok(tabla('postgres', { orden: O, pkColumnas: ['id'] }))
    check('limitOffset PG con orden: el de la cabecera, NO la PK; sin filtro `$1`/`$2` como siempre', loO.sql === 'SELECT * FROM "public"."profile"\nORDER BY "SUELDO" DESC, "ID" ASC\nLIMIT $1 OFFSET $2' && J(loO.binds) === '[501,0]', loO.sql)

    // offsetFetch (SQL Server): OFFSET/FETCH detrás.
    const of = ok(construirConsultaTabla({ dialecto: 'sqlserver', objeto: SS, forma: 'offsetFetch', n: 11, desde: 20, filtro: F }))
    check(
      'offsetFetch: `OFFSET @p3 ROWS FETCH NEXT @p4` y binds `[…filtro, desde, n]`',
      of.sql.endsWith('ORDER BY (SELECT NULL)\nOFFSET @p3 ROWS FETCH NEXT @p4 ROWS ONLY') && J(of.binds) === J(['%a!_b%', '10', 20, 11]) && of.sinOrdenEstable === true,
      J(of)
    )
    const ofO = ok(construirConsultaTabla({ dialecto: 'sqlserver', objeto: SS, forma: 'offsetFetch', n: 11, desde: 0, orden: O, pkColumnas: ['ID'] }))
    check('offsetFetch con orden: el de la cabecera, sin `(SELECT NULL)` ni PK', ofO.sql.includes('ORDER BY "SUELDO" DESC, "ID" ASC\nOFFSET @p1') && ofO.sinOrdenEstable === undefined, ofO.sql)

    // keyset (SQLite): la clave detrás del filtro; con orden, cae a LIMIT/OFFSET.
    const ks = ok(construirConsultaTabla({ dialecto: 'sqlite', objeto: SQ, forma: 'keyset', n: 11, clave: { tipo: 'rowid', alias: 'rowid' }, despues: [{ sqlite: 'entero', valor: '7' }], filtro: F }))
    check(
      'keyset: `rowid > ?3`, `LIMIT ?4`, binds `[…filtro, clave, n]`',
      ks.sql.includes('\n)\n  AND rowid > ?3\nORDER BY rowid\nLIMIT ?4') && J(ks.binds) === J(['%a!_b%', { sqlite: 'entero', valor: '10' }, { sqlite: 'entero', valor: '7' }, 11]) && ks.columnasClave === 1,
      J(ks)
    )
    const ks1 = ok(construirConsultaTabla({ dialecto: 'sqlite', objeto: SQ, forma: 'keyset', n: 11, clave: { tipo: 'rowid', alias: 'rowid' }, filtro: F }))
    check('keyset primera página: `LIMIT ?3`', ks1.sql.endsWith('\nORDER BY rowid\nLIMIT ?3') && J(ks1.binds).endsWith(',11]'), ks1.sql)
    const ksO = ok(construirConsultaTabla({ dialecto: 'sqlite', objeto: SQ, forma: 'keyset', n: 11, desde: 10, clave: { tipo: 'rowid', alias: 'rowid' }, orden: O, filtro: F }))
    check('keyset con orden de la cabecera: cae a LIMIT/OFFSET `?3`/`?4`, sin clave', ksO.sql.endsWith('ORDER BY "SUELDO" DESC, "ID" ASC\nLIMIT ?3 OFFSET ?4') && !ksO.columnasClave && J(ksO.binds).endsWith(',11,10]'), ksO.sql)

    // Conteo: el filtro sí, el orden no.
    const cnt = ok(construirConteo({ dialecto: 'postgres', objeto: PG, filtro: F, orden: O }))
    check('conteo: el filtro con sus binds y SIN ORDER BY', cnt.sql.startsWith('SELECT COUNT(*) FROM "public"."profile"\nWHERE (\n') && !cnt.sql.includes('ORDER BY') && J(cnt.binds) === J(['%a!_b%', '10']), J(cnt))
    const cntOra = ok(construirConteo({ dialecto: 'oracle', objeto: ORA, filtro: F }))
    check('conteo Oracle: binds por nombre', J(cntOra.binds) === J({ f1: '%a!_b%', f2: '10' }), J(cntOra.binds))
    check('conteo sin filtro: `[]` al byte', J(ok(construirConteo({ dialecto: 'oracle', objeto: ORA })).binds) === '[]', 'ok')

    // Exclusiones y vacíos.
    const ex1 = err(tabla('postgres', { filtro: F, where: 'x = 1' }))
    const ex2 = err(tabla('postgres', { orden: O, orderBy: 'x' }))
    const ex3 = err(construirConteo({ dialecto: 'postgres', objeto: PG, filtro: F, where: 'x = 1' }))
    check('NEGATIVO: filtro + WHERE, orden + ORDER BY -> error SIN campo', ex1 !== null && ex1.campo === null && ex2 !== null && ex2.campo === null && ex3 !== null, J([ex1, ex2, ex3]))
    const vacio = ok(tabla('postgres', { filtro: { union: 'todas', condiciones: [] }, orden: [], where: 'x = 1', orderBy: 'x' }))
    check('filtro sin condiciones y orden vacío cuentan como AUSENTES (el texto libre manda)', vacio.sql.includes('WHERE (\nx = 1\n)') && vacio.sql.includes('ORDER BY x'), vacio.sql)
    const blanco = ok(tabla('postgres', { filtro: F, where: '   ' }))
    check('un WHERE de solo blancos no choca con el filtro', blanco.rangos.filtro?.length === 2, J(blanco.rangos))

    // Inválidos: campo 'filtro' + condicion.
    const inv = err(tabla('oracle', { filtro: { union: 'todas', condiciones: [F.condiciones[0], { columna: 'X', categoria: 'numero', operador: 'igual', valor: 'doce' }] } }))
    check('un valor inválido -> `campo: "filtro"`, `condicion: 1`, sin posición', inv !== null && inv.campo === 'filtro' && inv.condicion === 1 && inv.posicion === null, J(inv))
    const invU = err(tabla('oracle', { filtro: { union: 'x', condiciones: [] } as unknown as DbFiltroGuiado }))
    check('del filtro entero -> `campo: "filtro"` SIN condicion', invU !== null && invU.campo === 'filtro' && invU.condicion === undefined, J(invU))
    const invO = err(tabla('oracle', { orden: [{ columna: 'A', dir: 'arriba' }] as unknown as DbOrdenColumna[] }))
    check('un orden inválido -> error sin campo', invO !== null && invO.campo === null, J(invO))

    // campoDeError: dentro de una condición -> su índice; en el SELECT, null.
    const [ini1, fin1] = (lo.rangos.filtro ?? [])[1]
    check('campoDeError en la 2.ª condición -> `{ campo: "filtro", condicion: 1 }`', J(campoDeError(lo, ini1 + 5)) === J({ campo: 'filtro', condicion: 1 }), J(campoDeError(lo, ini1 + 5)))
    check('campoDeError en el `)` de cierre -> la última condición', J(campoDeError(lo, fin1 + 1)) === J({ campo: 'filtro', condicion: 1 }), J(campoDeError(lo, fin1 + 1)))
    check('campoDeError en el SELECT o el LIMIT -> null', campoDeError(lo, 0) === null && campoDeError(lo, lo.sql.indexOf('LIMIT')) === null, 'null')
    const lineaSegunda = of.sql.slice(0, (of.rangos.filtro ?? [])[1][0]).split('\n').length
    check('SQL Server por LÍNEA: la de la 2.ª condición -> condicion 1', J(campoDeErrorEnLinea(of, lineaSegunda)) === J({ campo: 'filtro', condicion: 1 }), J(campoDeErrorEnLinea(of, lineaSegunda)))

    // Todo compuesto sigue siendo UNA sentencia.
    const una = [cur, rn, lo, of, ks, cnt].every((c, i) => dividirSentencias(c.sql, (['oracle', 'oracle', 'postgres', 'sqlserver', 'sqlite', 'postgres'] as DialectoSql[])[i]).length === 1)
    check('cada SQL con filtro es UNA sentencia para el divisor', una, 'ok')
  }

  // ---------------------------------------------------------------------------
  const total = results.length
  const passed = results.filter((r) => r.pass).length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
